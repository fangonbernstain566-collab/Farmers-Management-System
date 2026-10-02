import express, { type ErrorRequestHandler } from "express";
import session from "express-session";
import helmet from "helmet";
import { ZodError } from "zod";
import multer from "multer";
import path from "node:path";
import { statSync } from "node:fs";
import { config } from "./config.js";
import { PostgresSessionStore } from "./session-store.js";
import { csrf, hydrate } from "./security.js";
import { HttpError } from "./errors.js";
import { authFormPresentation } from "./auth-presentation.js";
import { auth } from "./routes/auth.js";
import { pages } from "./routes/pages.js";
export function createApp(store: session.Store = new PostgresSessionStore()) {
  const app = express();
  app.disable("x-powered-by");
  if (config.TRUST_PROXY) app.set("trust proxy", config.TRUST_PROXY);
  app.set("view engine", "ejs");
  app.set("views", path.resolve("views"));
  // A freshly rendered page must not reuse an older interaction script/style.
  app.locals.assetVersion = () =>
    Math.max(
      statSync(path.resolve("public/app.js")).mtimeMs,
      statSync(path.resolve("public/app.css")).mtimeMs,
      statSync(path.resolve("public/css/auth.css")).mtimeMs,
    ).toString();
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.NODE_ENV === "production" ? [] : null,
        },
      },
      strictTransportSecurity:
        config.NODE_ENV === "production" ? undefined : false,
    }),
  );
  app.use(
    "/assets",
    express.static(path.resolve("public"), { dotfiles: "deny", index: false }),
  );
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.use(express.urlencoded({ extended: false, limit: "64kb" }));
  app.use(
    session({
      name: "aringay.sid",
      secret: config.SESSION_SECRET,
      store,
      resave: false,
      saveUninitialized: false,
      rolling: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: config.NODE_ENV === "production",
        maxAge: 8 * 3600000,
      },
    }),
  );
  app.use(csrf);
  app.use(hydrate);
  app.use((req, res, next) => {
    res.locals.flash = req.session.flash ?? null;
    delete req.session.flash;
    res.locals.path = req.path;
    res.locals.unread = 0;
    next();
  });
  // Existing read-only page bookmarks remain valid; GET mutations never execute.
  const legacy: Record<string, string> = {
    "login.php": "/login",
    "register.php": "/register",
    "dashboard.php": "/dashboard",
    "admin_approvals.php": "/farmers",
    "profile.php": "/profile",
    "resources.php": "/resources",
    "notifications.php": "/notifications",
    "history.php": "/history",
    "complaints.php": "/complaints",
    "trash.php": "/trash",
    "setup_hectares.php": "/setup-hectares",
  };
  for (const [old, target] of Object.entries(legacy))
    app.get("/" + old, (req, res) => {
      const url = new URL(req.originalUrl, config.APP_ORIGIN);
      for (const param of [
        "delete_farmer",
        "delete_complaint",
        "restore",
        "perm_delete",
        "read_notification",
        "read_activity",
      ])
        url.searchParams.delete(param);
      if (url.searchParams.has("edit_complaint")) {
        url.searchParams.set("edit", url.searchParams.get("edit_complaint")!);
        url.searchParams.delete("edit_complaint");
      }
      res.redirect(target + url.search);
    });
  app.get("/logout.php", (_req, res) => res.redirect("/dashboard"));
  app.get("/", (req, res) => res.redirect(req.user ? "/dashboard" : "/login"));
  app.use(auth);
  app.use(pages);
  app.use((_req, _res, next) => next(new HttpError(404, "Page not found.")));
  const errors: ErrorRequestHandler = (error, req, res, _next) => {
    if (res.headersSent) return;
    if (
      req.method === "POST" &&
      ["/login", "/register"].includes(req.path) &&
      (error instanceof ZodError ||
        (error instanceof HttpError && error.status < 500))
    ) {
      const mode = req.path === "/register" ? "register" : "login";
      return res
        .status(error instanceof HttpError ? error.status : 400)
        .render("auth", {
          title:
            mode === "register"
              ? "Farmer Official Registration"
              : "Account Login",
          mode,
          user: res.locals.user ?? null,
          csrf: res.locals.csrf ?? "",
          path: req.path,
          flash: res.locals.flash ?? null,
          ...authFormPresentation(error, req.body, mode),
        });
    }
    let status = 500,
      message = "Unable to complete the request. Please try again.";
    if (error instanceof HttpError) {
      status = error.status;
      message = error.message;
    } else if (error instanceof ZodError) {
      status = 400;
      message = error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
    } else if (error instanceof multer.MulterError) {
      status = 400;
      message =
        "Invalid upload. Use one JPG, PNG, or WEBP image, 5 MB or smaller.";
    }
    if (status === 500)
      console.error(
        JSON.stringify({
          event: "request_failed",
          method: req.method,
          path: req.path,
        }),
      );
    res.status(status).render("error", {
      title: "Request could not be completed",
      message,
      user: res.locals.user ?? null,
      csrf: res.locals.csrf ?? "",
      path: req.path,
      unread: 0,
      flash: null,
    });
  };
  app.use(errors);
  return app;
}

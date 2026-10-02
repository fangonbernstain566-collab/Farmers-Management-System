// Offline browser checks: no live database, accounts, or email delivery.
// node --import tsx scripts/verify-auth-ui.mjs <browser-tools package.json> [chrome|firefox]
// Browser tools must provide playwright and @axe-core/playwright.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import helmet from "helmet";
import ejs from "ejs";
import { loginSchema, registrationSchema } from "../src/validation.ts";
import { authFormPresentation } from "../src/auth-presentation.ts";
import { frontendScenarios } from "../tests/frontend-fixtures.ts";

const requireTools = createRequire(
  path.resolve(process.argv[2] || "package.json"),
);
const { chromium, firefox } = requireTools("playwright");
const browserName = process.argv[3] || "chrome";
const { default: AxeBuilder } = requireTools("@axe-core/playwright");
const app = express();
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        formAction: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    strictTransportSecurity: false,
  }),
);
app.use("/assets", express.static(path.resolve("public")));
app.get("/favicon.ico", (_req, res) =>
  res.sendFile(path.resolve("public/logo.png")),
);
app.use(express.urlencoded({ extended: false }));
const fixtures = frontendScenarios();
const submissions = [];
for (const mode of ["login", "register"]) {
  const fixture = fixtures.find((item) => item.name === "auth-" + mode);
  app.get("/" + mode, async (_req, res) => {
    res.send(
      await ejs.renderFile(path.resolve("views/auth.ejs"), fixture.locals),
    );
  });
  app.post("/" + mode, (req, res) => {
    submissions.push({ path: req.path, body: req.body });
    res.send("Offline form submission received.");
  });
}
const invalid = registrationSchema.safeParse({
  email: "invalid",
  password: "weak",
});
app.get("/login-errors", async (_req, res) => {
  const fixture = fixtures.find((item) => item.name === "auth-login");
  const validation = loginSchema.safeParse({ email: "invalid", password: "" });
  res.send(
    await ejs.renderFile(path.resolve("views/auth.ejs"), {
      ...fixture.locals,
      ...authFormPresentation(validation.error, { email: "invalid" }, "login"),
    }),
  );
});
assert.equal(invalid.success, false);
app.get("/registration-errors", async (_req, res) => {
  const fixture = fixtures.find((item) => item.name === "auth-register");
  res.send(
    await ejs.renderFile(path.resolve("views/auth.ejs"), {
      ...fixture.locals,
      ...authFormPresentation(
        invalid.error,
        { email: "invalid", password: "weak" },
        "register",
      ),
    }),
  );
});
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
const artifacts = path.resolve("storage/verification/auth-ui", browserName);
await mkdir(artifacts, { recursive: true });
const browser =
  browserName === "firefox"
    ? await firefox.launch({ headless: true })
    : await chromium.launch({ channel: "chrome", headless: true });
const report = {
  browser: browserName,
  viewports: [],
  scrolling: [],
  accessibility: [],
  interactions: [],
  errors: [],
};
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (error) => report.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") report.errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      report.errors.push(response.url() + ": " + response.status());
  });
  for (const [width, height] of [
    [1440, 1000],
    [1440, 900],
    [1280, 720],
    [1600, 900],
    [1366, 768],
    [1366, 640],
    [1920, 1080],
    [1024, 768],
    [1024, 640],
    [768, 640],
    [768, 1024],
    [640, 900],
    [390, 844],
    [320, 740],
    [1024, 500],
    [1024, 620],
  ]) {
    await page.setViewportSize({ width, height });
    const desktop =
      (width >= 1024 && height >= 640) || (width >= 768 && height >= 701);
    for (const mode of ["login", "register"]) {
      await page.goto(origin + "/" + mode);
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.locator(".auth-shell").boundingBox();
      assert.ok(
        Math.abs(geometry.width - width) < 2,
        `Auth shell must fill viewport: ${geometry.width} / ${width}`,
      );
      assert.equal(await page.locator(".auth-overview").isVisible(), desktop);
      assert.equal(
        await page.locator("input[name=_csrf]").inputValue(),
        "offline-verification-csrf-token",
      );
      assert.equal(
        await page.locator("form").getAttribute("action"),
        "/" + mode,
      );
      assert.ok(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth + 1,
        ),
        `Overflow at ${width}px /${mode}`,
      );
      assert.equal(
        await page
          .locator("img")
          .evaluateAll((images) =>
            images.every((image) => image.complete && image.naturalWidth > 0),
          ),
        true,
      );
      const panel = page.locator(".auth-form-panel");
      if (desktop) {
        assert.ok(
          Math.abs(geometry.height - height) < 2,
          "Desktop auth must fit viewport height",
        );
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollHeight <= innerHeight + 1,
          ),
          "Document must not scroll",
        );
        assert.equal(
          await page.evaluate(() => getComputedStyle(document.body).overflowY),
          "hidden",
        );
        const overviewBefore = await page
          .locator(".auth-overview")
          .boundingBox();
        assert.ok(Math.abs(overviewBefore.height - height) < 2);
        for (const selector of [
          ".auth-scene-records",
          ".auth-scene-resources",
          ".auth-scene-community",
          ".auth-overview h2",
          ".auth-built-for",
          ".auth-office",
          ".auth-overview-footer",
        ]) {
          const bounds = await page.locator(selector).boundingBox();
          assert.ok(
            bounds.y >= 0 && bounds.y + bounds.height <= height + 1,
            `Illustration content clipped: ${selector} ${width}x${height}`,
          );
        }
        if (mode === "login") {
          assert.ok(
            await panel.evaluate(
              (el) => el.scrollHeight <= el.clientHeight + 1,
            ),
            `Login content clipped at ${width}x${height}`,
          );
          for (const selector of [
            ".auth-brand",
            "#auth-email",
            "#auth-password",
            ".auth-submit",
            ".auth-account-switch",
            ".auth-security",
            ".auth-panel-footer",
          ]) {
            const bounds = await page.locator(selector).boundingBox();
            assert.ok(
              bounds.y >= 0 && bounds.y + bounds.height <= height + 1,
              `Login control clipped: ${selector}`,
            );
          }
          await panel.hover({ position: { x: 8, y: 100 } });
          await page.mouse.wheel(0, 600);
          assert.equal(await panel.evaluate((el) => el.scrollTop), 0);
        } else {
          assert.ok(
            await panel.evaluate((el) => el.scrollHeight > el.clientHeight),
          );
          assert.equal(
            await panel.evaluate((el) => getComputedStyle(el).overflowY),
            "auto",
          );
          assert.equal(
            await panel.evaluate((el) => getComputedStyle(el).scrollbarWidth),
            "none",
          );
          assert.ok(
            await panel.evaluate((el) => el.offsetWidth === el.clientWidth),
            "No scrollbar consumes panel width",
          );
          await panel.hover({ position: { x: 8, y: 100 } });
          await page.mouse.wheel(0, 450);
          await page.waitForFunction(
            () => document.querySelector(".auth-form-panel").scrollTop > 0,
          );
          assert.deepEqual(
            await page.locator(".auth-overview").boundingBox(),
            overviewBefore,
            "Artwork must stay stationary on wheel scroll",
          );
          await panel.evaluate((el) => {
            el.scrollTop = 0;
            el.focus();
          });
          await page.keyboard.press("PageDown");
          await page.waitForFunction(
            () => document.querySelector(".auth-form-panel").scrollTop > 0,
          );
          await page.keyboard.press("End");
          await page.waitForFunction(() => {
            const el = document.querySelector(".auth-form-panel");
            return el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
          });
          const footer = await page.locator(".auth-panel-footer").boundingBox();
          assert.ok(
            footer.y >= 0 && footer.y + footer.height <= height,
            "Final links and footer reachable",
          );
          await page.keyboard.press("PageUp");
          await page.waitForFunction(() => {
            const el = document.querySelector(".auth-form-panel");
            return el.scrollTop + el.clientHeight < el.scrollHeight - 1;
          });
          for (const input of await page
            .locator(
              ".auth-form input:not([type=hidden]), .auth-form select, .auth-submit",
            )
            .all()) {
            await input.focus();
            await page.waitForFunction(
              (el) => {
                const bounds = el.getBoundingClientRect();
                return bounds.top >= 0 && bounds.bottom <= innerHeight + 1;
              },
              await input.elementHandle(),
              { timeout: 3000 },
            );
            const bounds = await input.boundingBox();
            assert.ok(
              bounds.y >= 0 && bounds.y + bounds.height <= height + 1,
              `Each field and submit button reachable by keyboard: ${await input.getAttribute("name")} ${JSON.stringify(bounds)} at ${width}x${height}`,
            );
          }
          await page.locator(".auth-overview").hover();
          await page.mouse.wheel(0, 600);
          assert.equal(
            await page.locator(".auth-overview").evaluate((el) => el.scrollTop),
            0,
          );
          assert.deepEqual(
            await page.locator(".auth-overview").boundingBox(),
            overviewBefore,
          );
          await panel.evaluate((el) => {
            el.scrollTop = 0;
            el.blur();
          });
        }
        assert.equal(await page.evaluate(() => scrollY), 0);
        report.scrolling.push(
          `${mode}: ${width}x${height}; fixed document/artwork; ${mode === "register" ? "hidden scrollbar, wheel and keyboard scrolling, all controls reachable" : "no scrolling or clipped controls"}`,
        );
      } else {
        assert.equal(
          await panel.evaluate((el) => getComputedStyle(el).overflowY),
          "visible",
        );
        await page.locator(".auth-submit").scrollIntoViewIfNeeded();
        const bounds = await page.locator(".auth-submit").boundingBox();
        assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= height);
        await page.evaluate(() => scrollTo(0, 0));
        report.scrolling.push(
          `${mode}: ${width}x${height}; single column, normal page scrolling, submit reachable`,
        );
      }
      assert.equal(
        await page.evaluate(() => document.fonts.check('14px "DM Sans"')),
        true,
      );
      await page.screenshot({
        path: path.join(artifacts, `${mode}-${width}.png`),
        fullPage: true,
      });
      report.viewports.push(
        `${mode}: ${width} × ${height}; no horizontal overflow`,
      );
      if ([1440, 768, 390, 320].includes(width)) {
        const result = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        assert.deepEqual(
          result.violations.map(({ id, nodes }) => ({
            id,
            targets: nodes.map((node) => node.target),
          })),
          [],
          `Accessibility /${mode} ${width}`,
        );
        report.accessibility.push(
          `${mode}: ${width}px; zero WCAG A/AA violations`,
        );
      }
    }
  }
  if (browserName === "chrome") {
    const touchContext = await browser.newContext({
      hasTouch: true,
      viewport: { width: 1366, height: 768 },
    });
    const touchPage = await touchContext.newPage();
    await touchPage.goto(origin + "/register");
    const overviewBefore = await touchPage
      .locator(".auth-overview")
      .boundingBox();
    const cdp = await touchContext.newCDPSession(touchPage);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 180, y: 600 }],
    });
    for (const y of [560, 520, 480, 440, 400, 360, 320, 280]) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: 180, y }],
      });
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await touchPage.waitForFunction(
      () => document.querySelector(".auth-form-panel").scrollTop > 0,
    );
    assert.equal(await touchPage.evaluate(() => scrollY), 0);
    assert.deepEqual(
      await touchPage.locator(".auth-overview").boundingBox(),
      overviewBefore,
    );
    report.interactions.push(
      "Registration: emulated touch swipe scrolls only the left panel",
    );
    await touchContext.close();
  }
  for (const [width, height] of [
    [1366, 768],
    [1366, 640],
    [768, 640],
    [768, 768],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(origin + "/login-errors");
    if (width >= 1024 || height >= 701)
      assert.ok(
        await page
          .locator(".auth-form-panel")
          .evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
        `Login validation errors must not clip controls at ${width}x${height}`,
      );
    await page.locator(".auth-panel-footer").scrollIntoViewIfNeeded();
    const bounds = await page.locator(".auth-panel-footer").boundingBox();
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= height + 1);
    report.scrolling.push(
      `Login validation errors: ${width}x${height}; all content reachable`,
    );
  }
  for (const mode of ["login", "register"]) {
    await page.goto(origin + "/" + mode);
    const password = page.locator("#auth-password");
    const toggle = page.locator("[data-password-toggle]");
    await password.fill("StrongPassword1!");
    await toggle.focus();
    await page.keyboard.press("Enter");
    assert.equal(await password.getAttribute("type"), "text");
    assert.equal(await toggle.getAttribute("aria-label"), "Hide password");
    assert.equal(await toggle.getAttribute("aria-pressed"), "true");
    await page.keyboard.press("Space");
    assert.equal(await password.getAttribute("type"), "password");
    assert.equal(await password.inputValue(), "StrongPassword1!");
    assert.equal(
      submissions.length,
      mode === "login" ? 0 : 1,
      "Toggle must not submit",
    );
    await page.locator("#auth-email").fill("ui@example.test");
    if (mode === "register") {
      await page.locator("[name=fullname]").fill("UI Test Farmer");
      await page.locator("[name=contact_number]").fill("09123456789");
      await page.locator("[name=birthdate]").fill("2000-01-01");
      await page.locator("[name=age]").fill("26");
      await page.locator("[name=gender]").selectOption("Male");
      await page.locator("[name=civil_status]").selectOption("Single");
      await page.locator("[name=place_of_birth]").fill("Aringay");
      await page.locator("[name=address]").fill("Poblacion, Aringay");
    }
    await Promise.all([
      page.waitForURL(origin + "/" + mode),
      page.locator(".auth-submit").click(),
    ]);
    await page.getByText("Offline form submission received.").waitFor();
    const submission = submissions.at(-1);
    assert.equal(submission.path, "/" + mode);
    assert.equal(submission.body._csrf, "offline-verification-csrf-token");
    assert.equal(submission.body.password, "StrongPassword1!");
    assert.equal(submission.body.email, "ui@example.test");
    if (mode === "register")
      assert.equal(registrationSchema.safeParse(submission.body).success, true);
    report.interactions.push(
      `${mode}: keyboard password toggle and native POST with correct fields/CSRF`,
    );
  }
  await page.goto(origin + "/registration-errors");
  assert.equal(await page.locator("[aria-invalid=true]").count(), 10);
  assert.equal(await page.locator("#auth-password").inputValue(), "");
  const errorAudit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    errorAudit.violations.map((item) => item.id),
    [],
  );
  report.accessibility.push(
    "Registration error state: zero WCAG A/AA violations",
  );
  const noJS = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const staticPage = await noJS.newPage();
  for (const mode of ["login", "register"]) {
    await staticPage.goto(origin + "/" + mode);
    assert.equal(
      await staticPage.locator(".password-toggle").isVisible(),
      false,
    );
    assert.equal(await staticPage.locator(".auth-submit").isVisible(), true);
    assert.equal(
      await staticPage.locator("#auth-password").getAttribute("type"),
      "password",
    );
  }
  await noJS.close();
  report.interactions.push(
    "Both forms usable without JavaScript; hidden password toggle",
  );
  assert.deepEqual(report.errors, [], "Browser console, page and asset errors");
  await writeFile(
    path.join(artifacts, "verification.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

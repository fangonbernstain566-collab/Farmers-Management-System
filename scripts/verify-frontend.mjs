// Offline browser verification. No app/config/database imports or live data.
// node --import tsx scripts/verify-frontend.mjs <tools package.json> [original views]
// The tools directory needs playwright and @axe-core/playwright installed.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import helmet from "helmet";
import ejs from "ejs";
import { frontendScenarios } from "../tests/frontend-fixtures.ts";

const requireTools = createRequire(
  path.resolve(process.argv[2] || "package.json"),
);
const { chromium } = requireTools("playwright");
const { default: AxeBuilder } = requireTools("@axe-core/playwright");
const originalViews = process.argv[3];
const scenarios = frontendScenarios();
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
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
    strictTransportSecurity: false,
  }),
);
app.use("/assets", express.static(path.resolve("public")));
app.get("/images/:kind/:id", (_req, res) =>
  res.sendFile(path.resolve("public/logo.png")),
);
app.get("/preview/:name", async (req, res, next) => {
  try {
    const fixture = scenarios.find((item) => item.name === req.params.name);
    if (!fixture) return res.sendStatus(404);
    res.send(
      await ejs.renderFile(
        path.resolve("views", fixture.page + ".ejs"),
        fixture.locals,
      ),
    );
  } catch (error) {
    next(error);
  }
});
const submissions = [];
app.use(express.text({ type: () => true, limit: "10mb" }));
app.use((req, res) => {
  if (req.method !== "POST") return res.sendStatus(404);
  submissions.push({
    path: req.path,
    body: req.body,
    type: req.get("content-type"),
  });
  res.send(
    '<!doctype html><html lang="en"><title>Offline submission</title><body><main><h1>Offline submission received</h1></main></body></html>',
  );
});
const server = await new Promise((resolve) => {
  const running = app.listen(0, "127.0.0.1", () => resolve(running));
});
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
const artifacts = path.resolve(".frontend-temp/screenshots");
await mkdir(artifacts, { recursive: true });

function formContracts(html) {
  const document = new DOMParser().parseFromString(html, "text/html");
  return Array.from(document.querySelectorAll("form"))
    .map((form) => ({
      action: form.getAttribute("action"),
      method: form.getAttribute("method"),
      encoding: form.getAttribute("enctype"),
      fields: Array.from(
        form.querySelectorAll("input[name], select[name], textarea[name]"),
      )
        .map((field) => ({
          name: field.name,
          value: field.value,
          required: field.required,
          type: field.type === "search" ? "text" : field.type,
          min: field.getAttribute("min"),
          max: field.getAttribute("max"),
          step: field.getAttribute("step"),
        }))
        .sort((a, b) => (a.name + a.value).localeCompare(b.name + b.value)),
    }))
    .sort((a, b) => (a.action + a.method).localeCompare(b.action + b.method));
}

const report = {
  scenarios: scenarios.length,
  responsiveChecks: 0,
  accessibilityChecks: 0,
  formComparisons: 0,
  interactions: [],
};
try {
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const fixture of scenarios) {
      await page.goto(origin + "/preview/" + fixture.name);
      await page.waitForFunction(() =>
        document.documentElement.classList.contains("js"),
      );
      const layout = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        width: document.documentElement.scrollWidth,
        main: document.querySelector("main").getBoundingClientRect().toJSON(),
        sidebar: document.querySelector(".sidebar")
          ? getComputedStyle(document.querySelector(".sidebar")).visibility
          : null,
      }));
      assert.ok(
        layout.width <= layout.viewport + 1,
        `${fixture.name} overflows at ${width}px (${layout.width}px)`,
      );
      assert.ok(
        layout.main.width > 0 && layout.main.right <= width + 1,
        `${fixture.name} content is outside viewport`,
      );
      if (width <= 900 && layout.sidebar)
        assert.equal(layout.sidebar, "hidden");
      report.responsiveChecks++;
      if (width === 1440) {
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        assert.deepEqual(
          results.violations.map((item) => ({
            id: item.id,
            nodes: item.nodes.map((node) => node.target),
          })),
          [],
          `${fixture.name} accessibility violations`,
        );
        report.accessibilityChecks++;
        if (originalViews && fixture.name !== "auth-login-signed-in") {
          const oldHtml = await ejs.renderFile(
            path.resolve(originalViews, fixture.page + ".ejs"),
            fixture.locals,
          );
          const newHtml = await page.content();
          const before = await page.evaluate(formContracts, oldHtml);
          const after = await page.evaluate(formContracts, newHtml);
          // Farmers previously received an inert admin inventory-delete form.
          const expected =
            fixture.page === "resources" &&
            fixture.locals.user?.role === "farmer"
              ? before.filter((form) => form.action !== "/resources/delete")
              : before;
          // Receipt confirmation now submits an existing distribution ID; the
          // old timestamp field caused PostgreSQL Date/precision failures.
          for (const form of expected.filter(
            (form) => form.action === "/receipts/confirm",
          )) {
            const field = form.fields.find(
              (field) => field.name === "batch_received_at",
            );
            if (field) {
              const receipt = fixture.locals.batches.find(
                (batch) => String(batch[0].created_at) === field.value,
              )[0];
              field.name = "distribution_id";
              field.value = String(receipt.id);
              form.fields.sort((a, b) =>
                (a.name + a.value).localeCompare(b.name + b.value),
              );
            }
          }
          assert.deepEqual(
            after,
            expected,
            `${fixture.name} form contracts changed`,
          );
          report.formComparisons++;
        }
      }
      if (
        [
          "dashboard-admin-populated",
          "auth-register",
          "resources-admin-populated",
          "notifications-farmer-populated",
          "profile-admin",
          "receipt-farmer-received",
          "trash-populated",
          "complaints-admin-populated",
        ].includes(fixture.name) &&
        width !== 768
      ) {
        await page.screenshot({
          path: path.join(artifacts, fixture.name + "-" + width + ".png"),
          fullPage: true,
        });
      }
    }
    console.log(`Rendered all ${scenarios.length} scenarios at ${width}px.`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + "/preview/dashboard-farmer-populated");
  await page.getByRole("button", { name: "Open navigation" }).click();
  assert.equal(
    await page.locator(".app-main").evaluate((element) => element.inert),
    true,
  );
  assert.equal(
    await page.locator("[data-sidebar-toggle]").getAttribute("aria-expanded"),
    "true",
  );
  await page.locator(".logout-button").focus();
  await page.keyboard.press("Tab");
  assert.equal(
    await page
      .locator(".sidebar-brand")
      .evaluate((element) => element === document.activeElement),
    true,
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await page
      .locator("[data-sidebar-toggle]")
      .evaluate((element) => element === document.activeElement),
    true,
  );
  assert.equal(
    await page.locator(".app-main").evaluate((element) => element.inert),
    false,
  );
  report.interactions.push(
    "Mobile drawer focus trap, inert content, Escape and focus restoration",
  );

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + "/preview/farmers-populated");
  await page.locator('form[action="/farmers/7/delete"] button').click();
  await page.locator("#confirm-dialog").waitFor({ state: "visible" });
  assert.equal(
    await page
      .locator("[data-confirm-cancel]")
      .evaluate((element) => element === document.activeElement),
    true,
  );
  await page.keyboard.press("Escape");
  assert.equal(submissions.length, 0);
  await page.locator('form[action="/farmers/7/delete"] button').click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(submissions.length, 0);
  await page.locator('form[action="/farmers/7/delete"] button').click();
  const dialogAxe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    dialogAxe.violations.map((item) => item.id),
    [],
  );
  await page
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await page.waitForURL((url) => url.pathname === "/farmers/7/delete");
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].path, "/farmers/7/delete");
  assert.ok(
    submissions[0].body.includes("_csrf=offline-verification-csrf-token"),
  );
  report.interactions.push(
    "Accessible confirmation, Escape/cancel without submission, one approved POST with CSRF",
  );

  await page.goto(origin + "/preview/resources-admin-populated");
  assert.equal(await page.locator("[data-delete-selected]").isDisabled(), true);
  await page.locator('[name="selected_resources"]').first().check();
  assert.equal(
    await page
      .locator("[data-select-all]")
      .evaluate((element) => element.indeterminate),
    true,
  );
  assert.equal(
    await page.locator("[data-selection-count]").innerText(),
    "1 selected",
  );
  await page.locator("[data-select-all]").check();
  assert.equal(
    await page.locator("[data-selection-count]").innerText(),
    "2 selected",
  );
  await page.locator("[data-delete-selected]").click();
  await page
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await page.waitForURL((url) => url.pathname === "/resources/delete");
  const selection = submissions.at(-1);
  assert.deepEqual(
    new URLSearchParams(selection.body).getAll("selected_resources"),
    ["3", "4"],
  );
  report.interactions.push(
    "Selection count, indeterminate state, disabled empty action and preserved resource IDs",
  );

  await page.goto(origin + "/preview/notifications-farmer-populated");
  await page.locator('input[name="proof"]').setInputFiles({
    name: "proof.png",
    mimeType: "image/png",
    buffer: await readFile("public/logo.png"),
  });
  await page
    .getByRole("button", { name: "Confirm receipt", exact: true })
    .click();
  await page
    .locator("#confirm-dialog")
    .getByRole("button", { name: "Confirm receipt", exact: true })
    .click();
  await page.waitForURL((url) => url.pathname === "/receipts/confirm");
  const upload = submissions.at(-1);
  assert.ok(upload.type.startsWith("multipart/form-data; boundary="));
  for (const value of [
    'name="_csrf"',
    "offline-verification-csrf-token",
    'name="distribution_id"',
    'name="proof"; filename="proof.png"',
  ])
    assert.ok(upload.body.includes(value));
  assert.match(upload.body, /name="distribution_id"\r\n\r\n21\r\n/);
  report.interactions.push(
    "Confirmed multipart receipt upload keeps CSRF, distribution ID and proof file",
  );

  await page.goto(origin + "/preview/auth-register");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  assert.ok((await page.locator(".field-error").count()) > 0);
  assert.equal(
    await page.locator('input[name="fullname"]').getAttribute("aria-invalid"),
    "true",
  );
  await page.locator('input[name="fullname"]').fill("Test Farmer");
  assert.equal(
    await page.locator('input[name="fullname"]').getAttribute("aria-invalid"),
    null,
  );
  assert.equal(await page.locator("#confirm-dialog").isVisible(), false);
  report.interactions.push(
    "Native required validation, inline errors and error recovery before confirmation",
  );

  await page.goto(origin + "/preview/flash-error");
  await page.getByRole("button", { name: "Dismiss message" }).click();
  assert.equal(await page.locator(".toast").count(), 0);
  report.interactions.push("Dismissible error flash");

  await page.goto(origin + "/preview/receipt-farmer-received");
  const download = page.waitForEvent("download");
  await page.locator("[data-receipt-png]").click();
  const image = await download;
  assert.equal(image.suggestedFilename(), "Receipt-REC-000021.png");
  const imagePath = path.join(artifacts, "Receipt-REC-000021.png");
  await image.saveAs(imagePath);
  const bytes = await readFile(imagePath);
  assert.equal(bytes.subarray(1, 4).toString(), "PNG");
  await page.emulateMedia({ media: "print" });
  assert.equal(await page.locator(".sidebar").isVisible(), false);
  assert.equal(await page.locator("[data-receipt-png]").isVisible(), false);
  await page.pdf({
    path: path.join(artifacts, "receipt.pdf"),
    format: "A4",
    printBackground: true,
  });
  report.interactions.push(
    "Actual receipt PNG download and PDF print rendering",
  );

  const noJs = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const staticPage = await noJs.newPage();
  await staticPage.goto(origin + "/preview/dashboard-farmer-empty");
  assert.equal(await staticPage.locator(".sidebar").isVisible(), true);
  assert.equal(await staticPage.locator("main").isVisible(), true);
  assert.ok(
    await staticPage.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
  );
  await noJs.close();
  report.interactions.push("Usable mobile navigation without JavaScript");

  assert.deepEqual(errors, [], "Browser console/page errors");
  await writeFile(
    path.join(artifacts, "verification.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

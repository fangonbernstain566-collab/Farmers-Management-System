// Offline browser checks with synthetic records/files; never imports app/config/DB.
// node --import tsx scripts/verify-proof-modal.mjs <tools package.json>
// The tools directory must contain playwright and @axe-core/playwright.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import express from "express";
import helmet from "helmet";
import ejs from "ejs";
import sharp from "sharp";
import { frontendScenarios } from "../tests/frontend-fixtures.ts";

const requireTools = createRequire(
  path.resolve(process.argv[2] || "package.json"),
);
const { chromium } = requireTools("playwright");
const { default: AxeBuilder } = requireTools("@axe-core/playwright");
const scenarios = frontendScenarios();
const app = express();
app.use(
  helmet({
    contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
    strictTransportSecurity: false,
  }),
);
app.use("/assets", express.static(path.resolve("public")));
const images = {
  22: {
    type: "image/png",
    data: await sharp({
      create: { width: 1600, height: 2400, channels: 3, background: "#eaf4ee" },
    })
      .png()
      .toBuffer(),
  },
  23: {
    type: "image/jpeg",
    data: await sharp({
      create: { width: 2400, height: 1200, channels: 3, background: "#edf3fc" },
    })
      .jpeg()
      .toBuffer(),
  },
};
app.get("/images/proof/:id", (req, res) => {
  const image = images[req.params.id];
  if (!image) return res.sendStatus(404);
  res
    .set({ "Content-Type": image.type, "Cache-Control": "private, no-store" })
    .send(image.data);
});
app.get("/preview/:name", async (req, res) => {
  const fixture = scenarios.find((item) => item.name === req.params.name);
  if (!fixture) return res.sendStatus(404);
  const records = scenarios.find(
    (item) => item.name === "history-farmer-populated",
  ).locals.records;
  const received = records[1];
  const proofs = [
    ...records,
    {
      ...received,
      id: 23,
      farmer_id: fixture.locals.user?.role === "admin" ? 8 : 7,
      fullname:
        fixture.locals.user?.role === "admin"
          ? "Juan Dela Cruz"
          : "Maria Santos",
      resource_name: "Fertilizer",
    },
  ];
  res.send(
    await ejs.renderFile(path.resolve("views", fixture.page + ".ejs"), {
      ...fixture.locals,
      records: proofs,
      allocations: proofs,
      documentation: proofs.filter((item) => item.proof_image),
    }),
  );
});
const server = await new Promise((resolve) => {
  const running = app.listen(0, "127.0.0.1", () => resolve(running));
});
let browser;
const report = {
  responsiveInteractions: 0,
  accessibilityChecks: 0,
  loadingAndFailureChecks: 0,
  navigationChecks: 0,
};
const artifacts = path.resolve(".frontend-temp/screenshots");
await mkdir(artifacts, { recursive: true });
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const origin = "http://127.0.0.1:" + server.address().port;
  const names = [
    "history-farmer-populated",
    "history-admin-populated",
    "dashboard-farmer-populated",
    "dashboard-admin-populated",
    "profile-admin",
  ];
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of names) {
      await page.goto(origin + "/preview/" + name);
      const url = page.url();
      await page.evaluate(() => {
        window.proofPageState = { preserved: true };
      });
      let navigationRequests = 0;
      let reloads = 0;
      const countNavigation = (request) => {
        if (
          request.isNavigationRequest() &&
          request.frame() === page.mainFrame()
        )
          navigationRequests++;
      };
      const countLoad = () => reloads++;
      page.on("request", countNavigation);
      page.on("load", countLoad);
      const modal = page.locator("#proof-dialog");
      const first = page.locator('[data-proof-url="/images/proof/22"]').first();
      const second = page
        .locator('[data-proof-url="/images/proof/23"]')
        .first();
      assert.equal(await modal.count(), 1);
      assert.equal(
        await page.getByText("No proof uploaded", { exact: true }).count(),
        1,
      );
      assert.equal(await page.locator('a[href^="/images/proof/"]').count(), 0);
      assert.equal(
        await page
          .locator('a[href^="/receipts/proof/"], a[href^="/proof/"]')
          .count(),
        0,
      );
      for (const control of await page.locator("[data-proof-url]").all()) {
        assert.equal(
          await control.evaluate((button) => button.tagName),
          "BUTTON",
        );
        assert.equal(await control.getAttribute("type"), "button");
        assert.equal(await control.getAttribute("href"), null);
        assert.equal(await control.getAttribute("target"), null);
      }
      await first.click();
      await page.waitForFunction(
        () =>
          document.querySelector("[data-proof-preview] img")?.naturalWidth >
            0 && !document.querySelector("[data-proof-preview]").hidden,
      );
      assert.equal(page.url(), url);
      assert.equal(context.pages().length, 1);
      assert.equal(
        await modal.locator("img").getAttribute("src"),
        "/images/proof/22",
      );
      assert.equal(
        await modal.locator('[data-proof-metadata="resource"] dd').innerText(),
        "Rice seeds",
      );
      assert.equal(
        await modal.locator('[data-proof-metadata="farmer"]').isVisible(),
        name.includes("admin"),
      );
      const layout = await modal.evaluate((dialog) => {
        const image = dialog.querySelector("img");
        const rect = dialog.getBoundingClientRect();
        const img = image.getBoundingClientRect();
        const footer = dialog.querySelector("footer").getBoundingClientRect();
        return {
          fits:
            rect.left >= 0 &&
            rect.right <= innerWidth &&
            rect.top >= 0 &&
            rect.bottom <= innerHeight,
          imageFits:
            img.width <=
            dialog.querySelector("[data-proof-preview]").clientWidth + 1,
          ratio: img.width / img.height,
          naturalRatio: image.naturalWidth / image.naturalHeight,
          closeVisible: footer.bottom <= innerHeight && footer.top >= rect.top,
        };
      });
      assert.equal(
        layout.fits && layout.imageFits && layout.closeVisible,
        true,
        name + " modal layout at " + width,
      );
      assert.ok(Math.abs(layout.ratio - layout.naturalRatio) < 0.01);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      assert.deepEqual(
        results.violations.map((item) => item.id),
        [],
        name + " modal accessibility",
      );
      report.accessibilityChecks++;
      await modal.getByRole("button", { name: "Close", exact: true }).focus();
      await page.keyboard.press("Tab");
      assert.equal(
        await modal
          .getByRole("button", { name: "Close proof viewer" })
          .evaluate((button) => button === document.activeElement),
        true,
        await page.evaluate(() =>
          document.activeElement.outerHTML.slice(0, 250),
        ),
      );
      await page.keyboard.press("Escape");
      await modal.waitFor({ state: "hidden" });
      assert.equal(
        await first.evaluate((button) => button === document.activeElement),
        true,
      );
      assert.equal(await modal.locator("img").count(), 0);
      await second.click();
      await page.waitForFunction(
        () =>
          document.querySelector("[data-proof-preview] img")?.naturalWidth ===
            2400 && !document.querySelector("[data-proof-preview]").hidden,
      );
      assert.equal(
        await modal.locator("img").getAttribute("src"),
        "/images/proof/23",
      );
      assert.equal(
        await modal.locator('[data-proof-metadata="resource"] dd').innerText(),
        "Fertilizer",
      );
      if (name.includes("admin"))
        assert.equal(
          await modal.locator('[data-proof-metadata="farmer"] dd').innerText(),
          "Juan Dela Cruz",
        );
      assert.equal(page.url(), url);
      await modal.getByRole("button", { name: "Close", exact: true }).click();
      await modal.waitFor({ state: "hidden" });
      assert.equal(
        await second.evaluate((button) => button === document.activeElement),
        true,
      );
      await first.click();
      await page.locator("[data-proof-preview]").waitFor({ state: "visible" });
      if (name === "history-admin-populated")
        await page.screenshot({
          path: path.join(artifacts, "proof-modal-" + width + ".png"),
        });
      await modal.getByRole("button", { name: "Close proof viewer" }).click();
      await modal.waitFor({ state: "hidden" });
      report.responsiveInteractions++;
      assert.equal(navigationRequests, 0, name + " requested a new document");
      assert.equal(reloads, 0, name + " reloaded");
      assert.equal(
        await page.evaluate(() => window.proofPageState?.preserved),
        true,
      );
      assert.equal(context.pages().length, 1);
      assert.equal(page.url(), url);
      page.off("request", countNavigation);
      page.off("load", countLoad);
      report.navigationChecks++;
    }
    console.log(
      `Proof interactions passed on all ${names.length} pages at ${width}px.`,
    );
  }

  // Failure stays inside the modal, does not show a broken image, and recovers.
  await page.goto(origin + "/preview/history-farmer-populated");
  const first = page.locator('[data-proof-url="/images/proof/22"]');
  const modal = page.locator("#proof-dialog");
  const url = page.url();
  await page.route("**/images/proof/22", (route) =>
    route.fulfill({ status: 404, body: "Not found" }),
  );
  await first.click();
  await page
    .getByText("Unable to load the proof file.", { exact: true })
    .waitFor();
  assert.equal(await modal.locator("img").count(), 0);
  assert.equal(page.url(), url);
  await page.keyboard.press("Escape");
  await modal.waitFor({ state: "hidden" });
  await page.unroute("**/images/proof/22");
  await first.click();
  await page.locator("[data-proof-preview]").waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await modal.waitFor({ state: "hidden" });
  report.loadingAndFailureChecks++;

  // Close during a delayed load, then view a different file without stale content.
  let release;
  let complete;
  const delayed = new Promise((resolve) => {
    release = resolve;
  });
  const completed = new Promise((resolve) => {
    complete = resolve;
  });
  await page.route("**/images/proof/22", async (route) => {
    await delayed;
    try {
      await route.fulfill({
        contentType: images[22].type,
        body: images[22].data,
      });
    } finally {
      complete();
    }
  });
  await first.click();
  await page.getByText("Loading proof file…", { exact: true }).waitFor();
  assert.equal(await page.locator("[data-proof-preview]").isVisible(), false);
  await page.keyboard.press("Escape");
  await modal.waitFor({ state: "hidden" });
  await page.locator('[data-proof-url="/images/proof/23"]').click();
  await page.locator("[data-proof-preview]").waitFor({ state: "visible" });
  release();
  await completed;
  assert.equal(
    await modal.locator("img").getAttribute("src"),
    "/images/proof/23",
  );
  await page.keyboard.press("Escape");
  await modal.waitFor({ state: "hidden" });
  await page.unroute("**/images/proof/22");
  report.loadingAndFailureChecks++;

  await first.evaluate((button) => {
    button.dataset.proofUrl = "https://example.test/private.png";
  });
  await page.locator('[data-proof-reference="LOG-00022"]').click();
  await page.getByText("No proof uploaded.", { exact: true }).waitFor();
  assert.equal(await modal.isVisible(), false);
  report.loadingAndFailureChecks++;
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  const staticPage = await noJs.newPage();
  await staticPage.goto(origin + "/preview/history-farmer-populated");
  assert.equal(
    await staticPage
      .locator('[data-proof-url="/images/proof/22"]')
      .isDisabled(),
    true,
  );
  await noJs.close();
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(artifacts, "proof-verification.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}

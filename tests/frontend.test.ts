import { describe, it, expect } from "vitest";
import ejs from "ejs";
import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import {
  frontendScenarios,
  type FrontendScenario,
} from "./frontend-fixtures.js";

const scenarios = frontendScenarios();
const render = (scenario: FrontendScenario) =>
  ejs.renderFile(
    path.resolve("views", scenario.page + ".ejs"),
    scenario.locals,
  );
const scenario = (name: string) =>
  scenarios.find((item) => item.name === name)!;

describe("offline frontend rendering", () => {
  it.each(scenarios)(
    "renders $name with intact POST CSRF protection",
    async (item) => {
      const html = await render(item);
      expect(html).toContain('<main class="');
      expect(html).toContain('id="main-content"');
      expect(html).toMatch(/<h1[\s>]/);
      expect(html).not.toMatch(/<%|\p{Extended_Pictographic}/u);
      for (const form of html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)) {
        if (/method="post"/.test(form[0])) {
          expect(form[0]).toContain(
            'name="_csrf" value="offline-verification-csrf-token"',
          );
        }
      }
      expect(html).not.toContain("legacy-pages.css");
    },
  );

  it("compiles every root EJS template and partial", async () => {
    for (const directory of ["views", "views/partials"]) {
      for (const file of await readdir(directory)) {
        if (!file.endsWith(".ejs")) continue;
        const filename = path.resolve(directory, file);
        const template = await readFile(filename, "utf8");
        expect(() => ejs.compile(template, { filename })).not.toThrow();
      }
    }
  });

  it("restricts farmer navigation and inventory actions to their role", async () => {
    for (const item of scenarios.filter(
      (item) =>
        (item.locals.user as { role?: string } | null)?.role === "farmer",
    )) {
      const html = await render(item);
      expect(html).not.toContain('href="/farmers');
      expect(html).not.toContain('href="/trash');
      expect(html).not.toContain('action="/resources/distribute"');
      expect(html).not.toContain('action="/resources/delete"');
      expect(html).not.toContain('action="/activities/read"');
      expect(html).not.toMatch(/action="\/distributions\/\d+\/delete"/);
      expect(html).not.toMatch(/action="\/complaints\/\d+\/confirm"/);
    }
  });

  it("keeps authentication free of dashboard navigation, including signed-in login", async () => {
    for (const name of [
      "auth-login",
      "auth-register",
      "auth-login-signed-in",
    ]) {
      const html = await render(scenario(name));
      expect(html).not.toContain('id="app-sidebar"');
      expect(html).toContain('class="auth-main"');
    }
  });

  it("preserves upload names, encoding, receipt selections, and mutation endpoints", async () => {
    const farmerEdit = await render(scenario("farmers-edit"));
    expect(farmerEdit).toContain(
      'action="/farmers/7/edit" method="post" enctype="multipart/form-data"',
    );
    for (const name of [
      "fullname",
      "birthdate",
      "age",
      "place_of_birth",
      "address",
      "contact_number",
      "gender",
      "civil_status",
      "hectares",
      "profile_pic",
    ]) {
      expect(farmerEdit).toContain(`name="${name}"`);
    }
    const complaint = await render(scenario("complaints-farmer-edit"));
    expect(complaint).toContain(
      'action="/complaints/8/edit" method="post" enctype="multipart/form-data"',
    );
    expect(complaint).toContain('name="complaint_image"');
    const notifications = await render(
      scenario("notifications-farmer-populated"),
    );
    expect(notifications).toContain(
      'action="/receipts/confirm" method="post" enctype="multipart/form-data"',
    );
    expect(notifications).toContain('name="distribution_id" value="21"');
    expect(notifications).not.toContain('name="batch_received_at"');
    expect(notifications).toContain('name="proof"');
    expect(notifications).toContain('action="/notifications/5/read"');
    const activity = await render(scenario("notifications-admin-populated"));
    expect(activity).toContain('action="/activities/read"');
    expect(activity).toContain('name="activity_key" value="distribution:21"');
    const history = await render(scenario("history-admin-populated"));
    expect(history).toContain('action="/distributions/21/delete"');
    expect(history).toContain('name="deletion_reason"');
    const trash = await render(scenario("trash-populated"));
    for (const table of ["users", "resources", "distributions", "complaints"]) {
      expect(trash).toContain(`action="/trash/${table}/7/restore"`);
      expect(trash).toContain(`action="/trash/${table}/7/delete"`);
    }
  });

  it("retains dynamic database values and escapes user-generated text", async () => {
    const item = scenario("dashboard-admin-populated");
    const html = await render(item);
    expect(html).toContain("340.50");
    expect(html).toContain("25.5000");
    const payload = '<script>alert("unsafe")</script>';
    const error = await render({
      ...scenario("error-anonymous"),
      locals: { ...scenario("error-anonymous").locals, message: payload },
    });
    expect(error).not.toContain(payload);
    expect(error).toContain("&lt;script&gt;");
    const farmers = scenario("farmers-populated");
    const escaped = await render({
      ...farmers,
      locals: { ...farmers.locals, search: payload },
    });
    expect(escaped).not.toContain(payload);
  });

  it("keeps printable receipts and locally served icons compatible with CSP", async () => {
    const html = await render(scenario("receipt-farmer-received"));
    expect(html).toContain('id="receipt-export"');
    expect(html).toContain('data-receipt-png="Receipt-REC-000021"');
    expect(html).toContain("data-print");
    expect(html).toContain('src="/assets/vendor/html2canvas.min.js"');
    expect(html).not.toMatch(/\son\w+=|\sstyle=|<script(?![^>]*\bsrc=)/);
    const sprite = await readFile("public/vendor/lucide.svg", "utf8");
    for (const item of scenarios) {
      for (const match of (await render(item)).matchAll(
        /href="\/assets\/vendor\/lucide.svg#([^"]+)"/g,
      )) {
        expect(sprite).toContain(`id="${match[1]}"`);
      }
    }
  });
});

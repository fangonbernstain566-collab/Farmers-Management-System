import { config } from "../config.js";

export function cleanHeader(value: string): string {
  return value.replace(/[\r\n]/g, "").trim();
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

function loginUrl(): string {
  const origin = new URL(config.APP_ORIGIN);
  // Do not include credentials, query parameters, or private record URLs.
  return new URL("/login", origin.origin).href;
}

export function emailText(name: string, message: string): string {
  return `Aringay Agriculture\nMunicipal Agriculture Management System\n\nHello ${name},\n\n${message}\n\nSign in: ${loginUrl()}\n\nThank you,\nAringay Agriculture\n\nThis is an automated system notification.`;
}

export function emailHtml(name: string, message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:20px;background:#f5f7f6;font-family:Arial,sans-serif;color:#20352b;line-height:1.6">
<table role="presentation" style="width:100%;max-width:600px;margin:auto;border-collapse:collapse;background:#ffffff"><tr><td style="padding:24px;border-bottom:1px solid #e0e7e3">
<h1 style="margin:0;font-size:24px;color:#195c42">Aringay Agriculture</h1><p style="margin:4px 0 0;font-size:13px;color:#607168">Municipal Agriculture Management System</p></td></tr>
<tr><td style="padding:24px;overflow-wrap:anywhere"><p>Hello ${escapeHtml(name)},</p><p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>
<p><a href="${escapeHtml(loginUrl())}" style="display:inline-block;padding:10px 18px;border-radius:6px;background:#195c42;color:#ffffff;text-decoration:none">Sign in to Aringay Agriculture</a></p>
<p>Thank you,<br>Aringay Agriculture</p><p style="font-size:12px;color:#607168">This is an automated system notification. Private proof files are available only after signing in.</p></td></tr></table></body></html>`;
}

export function emailDate(value: string | Date): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? String(value)
    : new Intl.DateTimeFormat("en-PH", {
        timeZone: "Asia/Manila",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date) + " (Philippine time)";
}

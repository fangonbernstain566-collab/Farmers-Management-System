// Usage: node scripts/build-icons.mjs <extracted lucide-static package directory>
// Vendor only the icons used by EJS and vanilla JavaScript; no runtime dependency.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const source = process.argv[2];
if (!source)
  throw new Error("Provide an extracted lucide-static package directory.");
const names = [
  "activity",
  "arrow-left",
  "arrow-right",
  "bell",
  "check",
  "circle-alert",
  "circle-check",
  "circle-user-round",
  "download",
  "eye",
  "history",
  "info",
  "layout-dashboard",
  "loader-circle",
  "log-in",
  "log-out",
  "menu",
  "message-square-warning",
  "package",
  "paperclip",
  "pencil",
  "plus",
  "printer",
  "receipt-text",
  "rotate-ccw",
  "save",
  "search",
  "send",
  "sprout",
  "trash-2",
  "triangle-alert",
  "truck",
  "upload",
  "users",
  "warehouse",
  "x",
];
const symbols = await Promise.all(
  names.map(async (name) => {
    const svg = await readFile(
      path.join(source, "icons", name + ".svg"),
      "utf8",
    );
    const body = svg.match(/<svg[\s\S]*?>([\s\S]*?)<\/svg>/)?.[1];
    if (!body) throw new Error("Invalid Lucide SVG: " + name);
    return `<symbol id="${name}" viewBox="0 0 24 24">${body}</symbol>`;
  }),
);
await writeFile(
  "public/vendor/lucide.svg",
  `<!-- Lucide Static 1.49.0, ISC license; see lucide-LICENSE.txt -->\n<svg xmlns="http://www.w3.org/2000/svg">\n${symbols.join("\n")}\n</svg>\n`,
);
await writeFile(
  "public/vendor/lucide-LICENSE.txt",
  await readFile(path.join(source, "LICENSE")),
);
console.log(`Vendored ${names.length} Lucide icons.`);

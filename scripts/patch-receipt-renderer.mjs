// html2canvas 1.4.1 injects constant pseudo-element CSS into its cloned body.
// Serve those rules from a local file without weakening the application CSP.
// This narrowly scoped patch is reproducible from the locked npm dependency.
import { readFile, writeFile } from "node:fs/promises";
const source = await readFile(
  "node_modules/html2canvas/dist/html2canvas.min.js",
  "utf8",
);
const before =
  'Sn=function(A,e){var t=A.ownerDocument;t&&((t=t.createElement("style")).textContent=e,A.appendChild(t))}';
const after =
  'Sn=function(A,e){var t=A.ownerDocument;t&&((t=t.createElement("link")).rel="stylesheet",t.href="/assets/vendor/html2canvas.css",A.appendChild(t))}';
if (source.split(before).length !== 2) {
  throw new Error(
    "html2canvas patch target changed; review the installed version.",
  );
}
await writeFile(
  "public/vendor/html2canvas.min.js",
  source.replace(before, after),
);
console.log("Externalized html2canvas clone CSS for the existing CSP.");

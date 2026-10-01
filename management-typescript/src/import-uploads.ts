import { readdir, mkdir, copyFile, lstat } from "node:fs/promises";
import path from "node:path";
import { storagePath, validateImage } from "./uploads.js";
import { readFile } from "node:fs/promises";
const source = process.argv[2];
if (!source) {
  console.error(
    "Usage: npm run uploads:import -- /absolute/path/to/old/uploads",
  );
  process.exitCode = 1;
} else {
  let count = 0,
    skipped = 0;
  async function visit(dir: string, relative = ""): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const local = path.join(dir, entry.name);
      const rel = relative ? relative + "/" + entry.name : entry.name;
      if ((await lstat(local)).isSymbolicLink())
        throw new Error("Symlinks are not allowed");
      if (entry.isDirectory()) await visit(local, rel);
      else if (entry.isFile()) {
        if (!/\.(jpe?g|png|webp)$/i.test(entry.name)) {
          skipped++;
          continue;
        }
        await validateImage(await readFile(local));
        const target = storagePath(rel);
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        await copyFile(local, target, 1);
        count++;
      }
    }
  }
  try {
    await visit(path.resolve(source));
    console.log(
      `Imported ${count} images; skipped ${skipped} non-image files. No files overwritten.`,
    );
  } catch {
    console.error(
      "Import stopped. Check existing destinations, image validity, size, and permissions. Some prior files may have been copied.",
    );
    process.exitCode = 1;
  }
}

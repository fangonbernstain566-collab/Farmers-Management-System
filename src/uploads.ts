import multer from "multer";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink, realpath, readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { HttpError } from "./errors.js";
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 25, fieldSize: 25000 },
});
export function storagePath(value: string): string {
  const clean = value.replace(/^uploads\//, "");
  if (
    !clean ||
    clean.includes("\\") ||
    clean.includes("\0") ||
    path.isAbsolute(clean) ||
    clean.split("/").some((p) => p === ".." || p === "." || p === "")
  )
    throw new HttpError(400, "Invalid file path.");
  const result = path.resolve(config.UPLOAD_DIR, clean);
  if (!result.startsWith(config.UPLOAD_DIR + path.sep))
    throw new HttpError(400, "Invalid file path.");
  return result;
}
export async function validateImage(
  buffer: Buffer,
): Promise<"jpeg" | "png" | "webp"> {
  if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024)
    throw new HttpError(400, "Images must be 5 MB or smaller.");
  try {
    const image = sharp(buffer, { limitInputPixels: 40000000 });
    const meta = await image.metadata();
    if (
      !["jpeg", "png", "webp"].includes(meta.format ?? "") ||
      !meta.width ||
      !meta.height ||
      (meta.pages ?? 1) > 1
    )
      throw new Error();
    await image.stats();
    return meta.format as "jpeg" | "png" | "webp";
  } catch {
    throw new HttpError(
      400,
      "Only valid JPG, PNG, or WEBP images are allowed.",
    );
  }
}
export async function saveImage(
  file: Express.Multer.File | undefined,
  folder = "",
): Promise<string | null> {
  if (!file) return null;
  const format = await validateImage(file.buffer);
  const extension = path.extname(file.originalname).toLowerCase();
  if (![".jpg", ".jpeg", ".png", ".webp"].includes(extension))
    throw new HttpError(400, "Invalid image extension.");
  // Re-encode to remove embedded metadata / trailing payloads; preserve visual content.
  const data = await sharp(file.buffer, { limitInputPixels: 40000000 })
    .toFormat(format)
    .toBuffer();
  const name =
    (folder ? folder + "/" : "") +
    randomUUID() +
    "." +
    (format === "jpeg" ? "jpg" : format);
  const target = storagePath(name);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, data, { flag: "wx", mode: 0o600 });
  return folder ? "uploads/" + name : name;
}
export async function removeImage(value: string | null): Promise<void> {
  if (!value || value === "default.png") return;
  try {
    await unlink(storagePath(value));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
export async function readImage(
  value: string,
): Promise<{ data: Buffer; type: string }> {
  const target = storagePath(value);
  const actual = await realpath(target).catch(() => {
    throw new HttpError(404, "Image not found.");
  });
  if (!actual.startsWith(config.UPLOAD_DIR + path.sep))
    throw new HttpError(404, "Image not found.");
  const data = await readFile(actual);
  const format = await validateImage(data);
  return { data, type: "image/" + format };
}

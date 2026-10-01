import "dotenv/config";
import { z } from "zod";
import path from "node:path";
const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.url().default("http://localhost:3000"),
  SESSION_SECRET: z
    .string()
    .min(32)
    .refine((v) => !v.startsWith("replace-"), "Generate a real session secret"),
  DB_HOST: z.string().default("127.0.0.1"),
  DB_PORT: z.coerce.number().int().default(3306),
  DB_NAME: z
    .string()
    .regex(/^[a-zA-Z0-9_]+$/)
    .default("management"),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().default(""),
  DB_TLS: bool,
  UPLOAD_DIR: z.string().default("./storage/uploads"),
  TRUST_PROXY: z.coerce.number().int().min(0).max(1).default(0),
  SMTP_HOST: z.string().default("smtp.gmail.com"),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_ENCRYPTION: z.enum(["tls", "ssl"]).default("tls"),
  SMTP_USER: z.string().default(""),
  SMTP_PASSWORD: z.string().default(""),
  SMTP_FROM_ADDRESS: z.string().default(""),
  SMTP_FROM_NAME: z.string().default("Aringay Agriculture"),
  SMTP_TIMEOUT_MS: z.coerce.number().int().min(3000).default(10000),
  EMAIL_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(3),
  EMAIL_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(25),
});
const result = schema.safeParse(process.env);
if (!result.success)
  throw new Error(
    "Invalid configuration fields: " +
      result.error.issues.map((i) => i.path.join(".")).join(", "),
  );
export const config = {
  ...result.data,
  UPLOAD_DIR: path.resolve(result.data.UPLOAD_DIR),
};
if (
  config.NODE_ENV === "production" &&
  !config.APP_ORIGIN.startsWith("https://")
)
  throw new Error("Production requires HTTPS APP_ORIGIN");

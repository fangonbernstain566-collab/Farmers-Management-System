import { z } from "zod";
const text = (max: number) => z.string().trim().min(1).max(max);
export const id = z.coerce.number().int().positive().max(2147483647);
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T00:00:00Z");
    return (
      !Number.isNaN(d.valueOf()) &&
      d.toISOString().slice(0, 10) === v &&
      v <= new Date().toISOString().slice(0, 10)
    );
  }, "Enter a valid birthdate.");
export const profileSchema = z.object({
  fullname: text(100),
  birthdate: date,
  age: z.coerce.number().int().min(0).max(130),
  gender: z.enum(["Male", "Female", "Other"]),
  civil_status: z.enum(["Single", "Married", "Widowed", "Separated"]),
  address: text(255),
  contact_number: text(20),
  place_of_birth: text(255),
});
export const registrationSchema = profileSchema.extend({
  email: z.email().max(100),
  password: z
    .string()
    .min(8)
    .max(72)
    .refine(
      (v) =>
        /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v) && /[\W_]/.test(v),
      "Password must be 8+ chars with uppercase, lowercase, number, and symbol.",
    )
    .refine(
      (v) => Buffer.byteLength(v) <= 72,
      "Password exceeds bcrypt byte limit.",
    ),
});
export const loginSchema = z.object({
  email: z.email().max(100),
  password: z.string().min(1).max(1024),
});
export const farmerSchema = profileSchema.extend({
  hectares: z.coerce
    .number()
    .min(0)
    .max(99999999.99)
    .refine(
      (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-5,
      "Use at most 2 decimal places.",
    ),
});
export const hectaresSchema = z.object({
  hectares: farmerSchema.shape.hectares.refine(
    (v) => v > 0,
    "Please enter a hectare value greater than zero.",
  ),
});
export const complaintSchema = z.object({
  subject: text(150),
  message: text(20000),
});
export const resourceSchema = z.object({
  name: text(100),
  total_quantity: z.coerce
    .number()
    .positive()
    .max(99999999999)
    .refine(
      (v) => Math.abs(v * 10000 - Math.round(v * 10000)) < 0.001,
      "Use at most 4 decimal places.",
    ),
  unit: text(20),
});
export const reasonSchema = z.object({ deletion_reason: text(2000) });
export const tableSchema = z.enum([
  "users",
  "resources",
  "distributions",
  "complaints",
]);
const receiptSelectionMessage =
  "Please select a valid receipt. Refresh your notifications and try again.";
export const receiptConfirmationSchema = z.object({
  distribution_id: z
    .string({ error: receiptSelectionMessage })
    .regex(/^[1-9]\d{0,9}$/, receiptSelectionMessage)
    .transform(Number)
    .refine((value) => value <= 2147483647, receiptSelectionMessage),
});
export const activitySchema = z
  .string()
  .regex(/^(distribution|complaint):[1-9]\d{0,9}$/);
export const searchSchema = z.string().trim().max(100).default("");

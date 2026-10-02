import { ZodError } from "zod";
import { HttpError } from "./errors.js";

// Presentation only: the existing Zod schemas remain authoritative.
const fieldMessages: Record<string, string> = {
  fullname: "Enter your full name (up to 100 characters).",
  email: "Enter a valid email address (up to 100 characters).",
  birthdate: "Enter a valid date of birth that is not in the future.",
  age: "Enter a whole-number age between 0 and 130.",
  gender: "Select your gender.",
  civil_status: "Select your civil status.",
  address: "Enter your complete home address (up to 255 characters).",
  contact_number: "Enter your contact number (up to 20 characters).",
  place_of_birth: "Enter your place of birth (up to 255 characters).",
};
const valueLimits: Record<string, number> = {
  fullname: 100,
  email: 100,
  birthdate: 10,
  age: 3,
  gender: 6,
  civil_status: 9,
  address: 255,
  contact_number: 20,
  place_of_birth: 255,
};

export function authFormPresentation(
  error: ZodError | HttpError,
  body: unknown,
  mode: "login" | "register",
) {
  const submitted =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const formValues: Record<string, string> = {};
  for (const [field, limit] of Object.entries(valueLimits)) {
    if (
      (mode === "register" || field === "email") &&
      typeof submitted[field] === "string"
    )
      formValues[field] = submitted[field].slice(0, limit);
  }
  const fieldErrors: Record<string, string> = {};
  if (error instanceof ZodError) {
    for (const issue of error.issues) {
      const field = String(issue.path[0] ?? "");
      if (field === "password") {
        fieldErrors.password =
          mode === "register"
            ? "Use 8 or more characters with uppercase, lowercase, a number, and a symbol (maximum 72 bytes)."
            : "Enter your password (up to 1,024 characters).";
      } else if (fieldMessages[field])
        fieldErrors[field] = fieldMessages[field];
    }
  } else if (
    mode === "register" &&
    error.message === "The email address provided is already registered."
  ) {
    fieldErrors.email = error.message;
  }
  return {
    formValues,
    fieldErrors,
    authError:
      error instanceof ZodError
        ? "Please check the highlighted fields and try again."
        : error.message,
  };
}

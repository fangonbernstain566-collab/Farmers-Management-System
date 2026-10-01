import { pool, run } from "./db.js";
import { hashPassword } from "./password.js";
import { registrationSchema } from "./validation.js";
import { z } from "zod";
// Supply values through environment for one invocation, not command-line arguments.
try {
  const data = z
    .object({
      email: registrationSchema.shape.email,
      password: registrationSchema.shape.password,
      fullname: z.string().trim().min(1).max(100),
    })
    .parse({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
      fullname: process.env.ADMIN_NAME,
    });
  await run(
    pool,
    "INSERT INTO users (fullname,email,password,role) VALUES (?,?,?,'admin')",
    [data.fullname, data.email, await hashPassword(data.password)],
  );
  console.log("Administrator created.");
} catch {
  console.error(
    "Administrator creation failed. Check input and duplicate email.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}

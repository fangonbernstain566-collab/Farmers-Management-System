import { defineConfig } from "vitest/config";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET ??=
  "test-secret-for-isolated-tests-01234567890123456789";
process.env.DB_USER ??= "management_test";
export default defineConfig({
  test: {
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 20000,
  },
});

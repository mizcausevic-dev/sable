import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 180000,
    hookTimeout: 180000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve("src"),
      "server-only": path.resolve("tests/stubs/server-only.ts"),
    },
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globals: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/**/*.ts"],
      // fs.ts is a node:fs wrapper with its own integration path via the CLI;
      // types.ts / index.ts are re-exports only.
      exclude: ["src/**/*.d.ts", "src/fs.ts", "src/types.ts", "src/index.ts"],
      thresholds: {
        lines: 70,
        branches: 65,
        functions: 80,
        statements: 70,
      },
    },
  },
});

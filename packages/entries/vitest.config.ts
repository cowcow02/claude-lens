import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    reporters: "default",
    // Force tests to run in a consistent timezone so date-splitting fixtures
    // behave identically in CI (UTC) and on developer machines.
    env: {
      TZ: "UTC",
    },
  },
});

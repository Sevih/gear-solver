import { defineConfig } from "vitest/config";

// Main-process tests run in plain Node. `electron` can't load outside an
// Electron runtime — any test that reaches paths.ts mocks it (test/electron-mock.ts).
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    sourcemap: false,
    assetsDir: "assets",
  },
  test: {
    environment: "node",
    include: ["tests/**/*.spec.ts"],
  },
});

import { defineConfig } from "vitest/config";

// lib/data.ts reads prepared_data.json off disk relative to process.cwd(), so
// tests must run with the project directory as cwd — the same cwd `next dev`
// and `next start` use. Pinning `root` here keeps `npm test` honest no matter
// where it's invoked from.
export default defineConfig({
  test: {
    root: __dirname,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});

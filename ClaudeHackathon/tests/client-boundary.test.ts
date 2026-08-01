/**
 * Person A — the client/server boundary guard.
 *
 * lib/data.ts imports `fs` and `path` and calls `process.cwd()`. In the App
 * Router that is fine in Route Handlers and Server Components, and fatal in
 * anything carrying the "use client" directive. Webpack's "Can't resolve 'fs'"
 * is not always the first thing that breaks — a Server Component pulled across
 * a client boundary can fail later and less obviously — so this is checked
 * statically rather than left to a build error someone might see at 3am.
 *
 * This runs on every `npm test`, so it keeps holding after Person D's UI lands.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const PROJECT_ROOT = path.join(__dirname, "..");
const SEARCH_DIRS = ["app", "lib", "components", "scripts", "src"];
const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectSourceFiles(full, acc);
    else if (SOURCE_EXT.has(path.extname(entry.name))) acc.push(full);
  }
  return acc;
}

const SOURCE_FILES = SEARCH_DIRS.flatMap((d) => collectSourceFiles(path.join(PROJECT_ROOT, d)));

function isClientComponent(source: string): boolean {
  // The directive is only meaningful at the very top of the file, before any
  // statement other than comments.
  const head = source.slice(0, 500);
  return /^\s*(?:\/\/.*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(head);
}

function importsDataLayer(source: string): boolean {
  return /(?:from|require\()\s*["'](?:@\/lib\/data|(?:\.{1,2}\/)+(?:lib\/)?data)["']/.test(source);
}

describe("client/server boundary", () => {
  it("finds source files to check (guards against a silently empty scan)", () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(0);
  });

  it("no client component imports the fs-dependent lib/data.ts", () => {
    const violations = SOURCE_FILES.filter((file) => {
      const source = fs.readFileSync(file, "utf-8");
      return isClientComponent(source) && importsDataLayer(source);
    }).map((f) => path.relative(PROJECT_ROOT, f));

    // If this fails: go through /api/data (or Person C's route) and fetch the
    // data instead of importing lib/data.ts into the client bundle.
    expect(violations).toEqual([]);
  });

  it("every importer of lib/data.ts is a route handler, server module, or test", () => {
    const importers = SOURCE_FILES.filter((file) =>
      importsDataLayer(fs.readFileSync(file, "utf-8"))
    ).map((f) => path.relative(PROJECT_ROOT, f).replace(/\\/g, "/"));

    for (const importer of importers) {
      const serverSide =
        /^app\/api\/.*\/route\.tsx?$/.test(importer) ||
        /^lib\//.test(importer) ||
        /^scripts\//.test(importer);
      expect(serverSide, `${importer} imports lib/data.ts from an unexpected place`).toBe(true);
    }
  });
});

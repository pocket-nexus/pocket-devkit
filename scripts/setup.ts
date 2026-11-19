// bun scripts/setup.ts — link the PocketJS checkout this repository builds against.
//
// The Devkit application is compiled by vendor/pocketjs but resolved from this
// repository: an import of "solid-js" or "@pocketjs/framework/components" in
// vita/app walks up to ./node_modules. These links point into the submodule and
// its installed packages, so there is one copy of Solid and one framework.

import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const VENDOR = resolve(ROOT, "vendor/pocketjs");

if (!existsSync(resolve(VENDOR, "package.json"))) {
  throw new Error("Pocket Devkit setup: initialize vendor/pocketjs first (git submodule update --init)");
}
// The pinned PocketJS names the Bun it runs on; .bun-version here, the one CI
// installs, names the same.
const bun = readFileSync(resolve(ROOT, ".bun-version"), "utf8").trim();
const pinned = readFileSync(resolve(VENDOR, ".bun-version"), "utf8").trim();
if (bun !== pinned) throw new Error(`Pocket Devkit setup: .bun-version says Bun ${bun}; vendor/pocketjs runs on Bun ${pinned}`);
if (Bun.version !== bun) throw new Error(`Pocket Devkit setup: this checkout runs on Bun ${bun} (.bun-version); this is Bun ${Bun.version}`);

const links = new Map<string, string>([
  ["node_modules/@pocketjs/framework", "vendor/pocketjs"],
  ["node_modules/solid-js", "vendor/pocketjs/node_modules/solid-js"],
  ["node_modules/typescript", "vendor/pocketjs/node_modules/typescript"],
  ["node_modules/bun-types", "vendor/pocketjs/node_modules/bun-types"],
  ["node_modules/@types/bun", "vendor/pocketjs/node_modules/@types/bun"],
]);
for (const [destination, source] of links) {
  const target = resolve(ROOT, source);
  if (!existsSync(target)) throw new Error(`Pocket Devkit setup: missing ${source}; run bun install in vendor/pocketjs`);
  const link = resolve(ROOT, destination);
  mkdirSync(dirname(link), { recursive: true });
  rmSync(link, { recursive: true, force: true });
  symlinkSync(relative(dirname(link), target), link, "dir");
}
console.log("Pocket Devkit setup: node_modules links into vendor/pocketjs ready");

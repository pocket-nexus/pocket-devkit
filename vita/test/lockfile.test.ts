// The Vita program builds on its own graph (vita/program/Cargo.lock). Every
// package it shares with vendor/pocketjs resolves to the same version, source
// and checksum, so the program compiles the code PocketJS tests.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STABLE_RUST_TOOLCHAIN } from "../../vendor/pocketjs/tools/build/toolchains/rust.ts";
import { PROGRAM, VENDOR } from "../tools/paths.ts";

type Locked = { name: string; version: string; source?: string; checksum?: string };
function packages(path: string): Locked[] {
  return (Bun.TOML.parse(readFileSync(path, "utf8")) as { package: Locked[] }).package;
}

test("the program lockfile resolves shared packages as vendor/pocketjs does", () => {
  const vendor = new Map(packages(join(VENDOR, "Cargo.lock")).map(p => [`${p.name}@${p.version}@${p.source ?? "path"}`, p]));
  const differing: string[] = [];
  for (const locked of packages(join(PROGRAM, "Cargo.lock"))) {
    if (locked.name === "pocket-devkit-vita") continue;
    const shared = vendor.get(`${locked.name}@${locked.version}@${locked.source ?? "path"}`);
    if (!shared || shared.checksum !== locked.checksum) differing.push(`${locked.name} ${locked.version}`);
  }
  expect(differing).toEqual([]);
});

test("the program lockfile is complete", () => {
  const result = Bun.spawnSync(["cargo", `+${STABLE_RUST_TOOLCHAIN}`, "metadata", "--locked", "--format-version=1",
    "--manifest-path", join(PROGRAM, "Cargo.toml")], { stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
}, 120_000);

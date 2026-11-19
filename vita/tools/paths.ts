// Where the PS Vita devkit's inputs and outputs are. PocketJS enters as the
// vendor/pocketjs submodule; every PocketJS tool is imported from there.

import { resolve } from "node:path";

export const ROOT = resolve(import.meta.dir, "../..");
export const VENDOR = resolve(ROOT, "vendor/pocketjs");
/** The Pocket Devkit application: the guest of the installed container. */
export const APP_CONFIG = resolve(ROOT, "vita/app/pocket.host.config.ts");
/** The Vita program crate with the USB developer host. */
export const PROGRAM = resolve(ROOT, "vita/program");
export const PROGRAM_PACKAGE = "pocket-devkit-vita";
/** Bundles, VPKs, SELFs and their development metadata. */
export const DIST = resolve(ROOT, "dist");
export const VITA_DIST = resolve(DIST, "vita");
/** Ignored build scratch: compiler plans, VPK asset trees, the USB share. */
export const BUILD = resolve(ROOT, ".pocket-build");

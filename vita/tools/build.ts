// The Vita build of Pocket Devkit (`bun run vita build`): compile an
// application bundle with `pocket compile`, build vita/program around it with
// PocketJS's Vita program build, and package the VPK with the USB kernel
// driver and the application's LiveArea art.
//
//   dist/<output>.pkb                       the application bundle
//   dist/vita/<output>.vpk                  install once in VitaShell
//   dist/vita/<output>.self                 the SELF `native` sends
//   dist/vita/<output>.runtime.json         development metadata the commands read
//
// Without --config the application is vita/app, Pocket Devkit itself.
// --generic builds the generic runtime instead (no application; the program
// reads app0:app.pkb). --title replaces the title derived from the
// application id: a build for `native` takes the installed container's title.

import { createHash, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { POCKET_BINDING_GENERATION } from "../../vendor/pocketjs/contracts/spec/binding-generation.ts";
import { vitaTitleId } from "../../vendor/pocketjs/framework/compiler/vita-title-id.ts";
import { hashPocketProfile } from "../../vendor/pocketjs/framework/src/profile.ts";
import { POCKET_PROFILES } from "../../vendor/pocketjs/hosts/index.ts";
import { prepareApplication } from "../../vendor/pocketjs/tools/build/inputs.ts";
import { compileApplication } from "../../vendor/pocketjs/tools/compile-app.ts";
import { withArtifactLock } from "../../vendor/pocketjs/tools/targets/lock.ts";
import { buildVitaProgram } from "../../vendor/pocketjs/tools/vita.ts";
import { APP_CONFIG, BUILD, DIST, PROGRAM, PROGRAM_PACKAGE, VITA_DIST } from "./paths.ts";
import { prepareVitaUsb } from "./vita-usb.ts";

const profile = POCKET_PROFILES.vita;
/** vitaTitleId("dev.pocket-nexus.devkit"): the installed container's title. */
export const DEVKIT_TITLE_ID = vitaTitleId("dev.pocket-nexus.devkit");
/** The VPK path the program loads the driver from (src/dev.rs start_driver). */
const DRIVER_VPK_PATH = "pocket-usbhostfs.skprx";

export interface DevkitBuild {
  /** The application's pocket.host.config.ts. Default: vita/app (Pocket Devkit). */
  readonly config?: string;
  /** Build the generic runtime: no application. */
  readonly generic?: boolean;
  readonly title?: string;
}

/** Development metadata beside each build; the vita commands read it. */
export interface DevkitMetadata {
  readonly version: 1;
  readonly titleId: string;
  readonly applicationId: string;
  readonly output: string;
  readonly nativeBuild: string;
  /** The resolved build plan `push` compiles against; null for the generic runtime. */
  readonly plan: unknown;
  readonly profileHash: string;
  /** The directory the plan's entries are relative to. */
  readonly projectRoot: string | null;
  readonly self: string;
  readonly selfSha256: string;
  readonly usbDriver: string;
}

export async function buildDevkit(options: DevkitBuild = {}): Promise<string> {
  if (options.generic && options.config) throw new Error("--generic builds a program without an application; give no --config");
  if (options.title !== undefined && !/^[A-Z][A-Z0-9]{8}$/.test(options.title)) {
    throw new Error(`--title must be nine uppercase letters and digits, got ${options.title}`);
  }
  const selected = { profile, profileHash: hashPocketProfile(profile), hostAbi: POCKET_BINDING_GENERATION, dependencies: [] };
  let application: ReturnType<typeof prepareApplication> | undefined;
  let projectRoot: string | undefined;
  if (!options.generic) {
    const config = resolve(options.config ?? APP_CONFIG);
    projectRoot = dirname(config);
    console.log(`Pocket Devkit: compiling ${config}`);
    const compiled = await compileApplication({ configPath: config, target: profile.id, outdir: DIST, planRoot: join(BUILD, "plans") });
    application = prepareApplication(selected, compiled.bundle!, join(BUILD, "vita"));
  }
  const output = application?.plan.app.output ?? "pocket-runtime";
  const titleId = options.title ?? vitaTitleId(application?.plan.app.id ?? "dev.pocket-nexus.runtime");
  const nativeBuild = randomBytes(16).toString("hex");
  const usb = await prepareVitaUsb();

  return withArtifactLock(join(BUILD, "native-locks/vita"), async () => {
    // The VPK tree: the application's `vita/` LiveArea art and the kernel driver.
    const assets = join(BUILD, "vita/assets", output);
    rmSync(assets, { recursive: true, force: true });
    mkdirSync(assets, { recursive: true });
    if (application) {
      const art = resolve(projectRoot!, dirname(application.plan.app.entry), "vita");
      if (existsSync(art)) cpSync(art, assets, { recursive: true });
    }
    cpSync(usb.driver, join(assets, DRIVER_VPK_PATH));

    const built = await buildVitaProgram({
      program: {
        directory: PROGRAM,
        package: PROGRAM_PACKAGE,
        env: {
          POCKETJS_VITA_PLAN: application?.planPath ?? "",
          POCKETJS_VITA_TITLE_ID: titleId,
          POCKETJS_NATIVE_BUILD: nativeBuild,
        },
        // HENkaku loads the kernel driver only for an unsafe-homebrew SELF.
        unsafe: true,
        assets,
      },
      profile,
      application,
      titleId,
      cargoArgs: ["--release"],
      outputDirectory: DIST,
      packageDirectory: VITA_DIST,
    });
    const metadata: DevkitMetadata = {
      version: 1, titleId, applicationId: built.applicationId, output, nativeBuild,
      plan: application?.plan ?? null, profileHash: built.profileHash, projectRoot: projectRoot ?? null,
      self: `${output}.self`, selfSha256: createHash("sha256").update(readFileSync(built.self)).digest("hex"),
      usbDriver: usb.fingerprint,
    };
    const path = join(VITA_DIST, `${output}.runtime.json`);
    writeFileSync(path, JSON.stringify(metadata, null, 2) + "\n");
    console.log(`Pocket Devkit: ${titleId} (${built.applicationId})\noutput: ${built.vpk}\nmetadata: ${path}`);
    return built.vpk;
  });
}

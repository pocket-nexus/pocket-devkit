// bun run vita <command> — the PS Vita wired development loop (README.md).
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { decodeBundle, encodeBundle } from "../../vendor/pocketjs/contracts/spec/bundle.ts";
import { extractHostBuildInputs } from "../../vendor/pocketjs/framework/compiler/host-build-inputs.ts";
import type { ResolvedBuildPlan } from "../../vendor/pocketjs/framework/compiler/plan.ts";
import { makeBundle } from "../../vendor/pocketjs/tools/bundle.ts";
import { guardDeviceCommand } from "../../vendor/pocketjs/tools/device-lease.ts";
import { encodePNG } from "../../vendor/pocketjs/tools/png.ts";
import { buildDevkit, type DevkitMetadata } from "./build.ts";
import { BUILD, ROOT, VENDOR, VITA_DIST } from "./paths.ts";
import { prepareVitaUsb } from "./vita-usb.ts";
import { atomicWrite, VitaUsbClient } from "./vita-dev-client.ts";

const args = Bun.argv.slice(2);
const command = args[0];
function value(flag: string): string | undefined {
  const inline = args.find(a => a.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
}
// Pocket Devkit (vita/app) is the installed development container.
const app = value("--app") ?? "devkit";
const output = app.endsWith("-main") ? app : `${app}-main`;
const metadataPath = resolve(value("--runtime") ?? join(VITA_DIST, `${output}.runtime.json`));
function metadata(): DevkitMetadata { return JSON.parse(readFileSync(metadataPath, "utf8")); }
const share = resolve(value("--dir") ?? join(BUILD, "vita-usb/share"));

async function run(argv: string[]): Promise<void> {
  const child = Bun.spawn(argv, { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error(`command failed: ${argv.join(" ")}`);
}

function capture(client: VitaUsbClient, receipt: any, stem = receipt.requestId): string {
  if (receipt.source !== "GXM" || receipt.width !== 960 || receipt.height !== 544 || receipt.stride !== 960) throw new Error("unexpected capture geometry/source");
  const pixels = Buffer.from(readFileSync(join(client.directory, `${receipt.requestId}.rgba`)));
  if (pixels.length !== 960 * 544 * 4) throw new Error("incomplete GXM capture");
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  const out = resolve(value("--out") ?? join(BUILD, "validation/vita-usb", stem, "frame.png"));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, encodePNG(pixels, 960, 544));
  writeFileSync(`${out}.json`, JSON.stringify(receipt, null, 2) + "\n");
  return out;
}

async function main(): Promise<void> {
  if (!command || args.includes("--help")) {
    console.log(`PS Vita wired development (USB only, no Wi-Fi fallback)
  bun run vita build   [--config app/pocket.host.config.ts | --generic] [--title TITLEID]
  bun run vita install --app devkit --mount /Volumes/PSV
  bun run vita serve   --app devkit
  bun run vita status  --app devkit
  bun run vita push    --app devkit [--bundle file.pkb]
  bun run vita native  --app devkit [--runtime file.runtime.json]
  bun run vita stage   --file x.vpk [--name x.vpk] [--into card|app]
  bun run vita capture --app devkit [--out frame.png]
  bun run vita reload|reset|menu --app devkit
  bun run vita watch   --app devkit [--watch-dir dir]
build compiles vita/app (Pocket Devkit) or --config's application into the
Devkit program; --generic builds the generic runtime instead. A build for
native takes the installed container's title: --title P25BFE5E2.
Use --title TITLEID to address a runtime and --dir to select the USB share.
Install stages a VPK over USB mass storage; install/open it once in VitaShell.
serve then owns the USB host. push rebuilds JS/PAK; native sends the SELF and
requires a receipt from the replacement process. stage writes a file to
ux0:data/pocket-runtime/ (card) for VitaShell to install, or app.pkb into
the title's directory (app) for a generic runtime's next start.
L+R+SELECT opens the menu.`);
    return;
  }
  if (command === "build") {
    await buildDevkit({ config: value("--config"), generic: args.includes("--generic"), title: value("--title") });
    return;
  }
  await guardDeviceCommand(command === "serve" ? "vita:usb:transport" : "vita:usb");
  const info = existsSync(metadataPath) ? metadata() : undefined;
  const title = value("--title") ?? info?.titleId;
  if (!title) throw new Error("build the Vita app first, or supply --title");
  const client = new VitaUsbClient(share, title, 60_000);
  if (command === "install") {
    if (!info?.output) throw new Error("install needs the development metadata from a Vita build");
    const mount = value("--mount");
    if (!mount || !existsSync(join(mount, "VitaShell"))) throw new Error("--mount must identify the VitaShell USB volume");
    const source = join(dirname(metadataPath), `${info.output}.vpk`);
    const dest = join(mount, "data/pocketjs-dev", `${info.output}.vpk`);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(source, dest);
    const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
    if (hash(source) !== hash(dest)) throw new Error("USB storage readback differs");
    console.log(`Staged and read back ${dest}\nSHA-256 ${hash(dest)}\nEject USB storage, install this VPK in VitaShell, then open its LiveArea bubble.`);
    return;
  }
  if (command === "serve") {
    const tools = await prepareVitaUsb({ host: true });
    mkdirSync(share, { recursive: true });
    const lock = join(share, "serve.lock");
    try { mkdirSync(lock); } catch { throw new Error(`USB host already owns ${share}; stop it before starting another`); }
    let child: ReturnType<typeof Bun.spawn> | undefined;
    let captures: ReturnType<typeof setInterval> | undefined;
    try {
      client.startSession();
      child = Bun.spawn([tools.host, "-t", "2000", share], { cwd: share, stdin: "pipe", stdout: "inherit", stderr: "inherit" });
      const stop = () => child?.kill();
      process.on("SIGINT", stop); process.on("SIGTERM", stop);
      console.log(`USB host serving ${title} from ${share}; waiting for Pocket Devkit`);
      let lastCapture = "";
      captures = setInterval(() => {
        try {
          const receipt = JSON.parse(readFileSync(join(client.directory, "menu-capture.json"), "utf8"));
          const key = `${receipt.nativeBuild}:${receipt.generation}:${receipt.frame}`;
          if (key !== lastCapture) {
            console.log(capture(client, { ...receipt, requestId: "menu-capture" }, `menu-${Date.now()}`));
            lastCapture = key;
          }
        } catch { /* No completed menu capture yet. */ }
      }, 250);
      await child.exited;
    } finally { if (captures) clearInterval(captures); rmSync(lock, { recursive: true, force: true }); }
    return;
  }
  if (command === "status") { console.log(JSON.stringify(await client.command("status"), null, 2)); return; }
  if (command === "capture") { console.log(capture(client, await client.command("capture"))); return; }
  if (command === "reload" || command === "reset" || command === "menu") { console.log(JSON.stringify(await client.command(command), null, 2)); return; }
  if (command === "native") {
    if (info?.titleId !== title) throw new Error("replacement must match the installed title; build it with --title");
    if (!/^[0-9a-f]{32}$/.test(info.nativeBuild) || !/^[\w.-]+\.self$/.test(info.self)) throw new Error("invalid native build metadata");
    const payload = readFileSync(join(dirname(metadataPath), info.self));
    if (createHash("sha256").update(payload).digest("hex") !== info.selfSha256) throw new Error("SELF does not match its build metadata");
    const result = await client.command("native", { payload, build: info.nativeBuild });
    console.log(JSON.stringify(result, null, 2)); return;
  }
  async function push() {
    if (!/^sha256:[0-9a-f]{64}$/.test(info?.profileHash ?? "")) throw new Error("push needs development metadata with profileHash; rebuild");
    let payload: Uint8Array;
    const bundlePath = value("--bundle");
    if (bundlePath) payload = readFileSync(bundlePath);
    else {
      if (!info?.plan) throw new Error("push needs a build plan or --bundle");
      const plan = info.plan as ResolvedBuildPlan;
      extractHostBuildInputs(plan, { expectedTarget: "vita", expectedProfileHash: info.profileHash });
      mkdirSync(client.directory, { recursive: true });
      const planPath = join(client.directory, "build.plan.json");
      atomicWrite(planPath, JSON.stringify(plan));
      // Compile JS/PAK from the plan the native build was made with.
      const outdir = join(BUILD, "vita/push");
      await run([process.execPath, join(VENDOR, "tools/build.ts"), `--plan=${planPath}`,
        `--project-root=${value("--project-root") ?? info.projectRoot ?? ROOT}`, `--outdir=${outdir}`]);
      payload = encodeBundle(makeBundle({
        plan, js: readFileSync(join(outdir, `${info.output}.js`)), pak: readFileSync(join(outdir, `${info.output}.pak`)),
      }));
    }
    if (decodeBundle(payload).profileHash !== info!.profileHash) throw new Error("bundle profileHash does not match the built Vita runtime");
    console.log(JSON.stringify(await client.command("push", { payload }), null, 2));
  }
  if (command === "push") { await push(); return; }
  if (command === "stage") {
    const file = value("--file");
    if (!file) throw new Error("stage needs --file");
    const into = (value("--into") ?? "card") as "card" | "app";
    const name = value("--name") ?? file.split("/").pop()!;
    console.log(JSON.stringify(await client.command("stage", { payload: readFileSync(file), name, into }), null, 2));
    return;
  }
  if (command === "watch") {
    const directory = resolve(value("--watch-dir") ?? info?.projectRoot ?? join(ROOT, "vita/app"));
    function stamp(path: string): string {
      return readdirSync(path, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))
        .map(e => e.isDirectory() ? stamp(join(path, e.name)) : `${e.name}:${statSync(join(path, e.name)).mtimeMs}`).join("|");
    }
    let previous = "";
    console.log(`Watching ${directory}; JS/resources reload after each successful build`);
    for (;;) {
      const next = stamp(directory);
      if (next !== previous) {
        try { await push(); previous = next; }
        catch (e) { console.error(String(e)); await Bun.sleep(2000); }
      }
      await Bun.sleep(500);
    }
  }
  throw new Error(`unknown Vita command: ${command}`);
}

if (import.meta.main) await main().catch(error => { console.error(`vita: ${error.message}`); process.exitCode = 1; });

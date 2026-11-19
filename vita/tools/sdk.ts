// bun vita/tools/sdk.ts <dir> — install the VitaSDK this repository builds
// with into <dir>/vitasdk and print its path: PocketJS's pinned release SDK
// and ports (vendor/pocketjs/tools/build/toolchains/vita.ts) plus the taiHEN
// stubs the USB host links (taihen_stub_weak) and the kernel driver links
// (taihenForKernel_stub, taihenModuleUtils_stub). Every archive is verified by
// SHA-256; the vitasdk/packages release tag is mutable, so a changed archive
// fails the install instead of replacing the pin. darwin-arm64 only, as the
// PocketJS release SDK.
import { resolve } from "node:path";
import { installVitaSdkBundle, VITA_RELEASE_SDK_ARCHIVES, type VitaSdkArchive } from "../../vendor/pocketjs/tools/build/toolchains/vita.ts";

export const TAIHEN_ARCHIVE: VitaSdkArchive = {
  name: "taihen", file: "taihen.tar.xz", destination: "arm-vita-eabi",
  url: "https://github.com/vitasdk/packages/releases/download/master/taihen.tar.xz",
  sha256: "afced213d9d308a665ef91809fd728614a92ec31b2fcf61cf1f6a3e98bec4014",
  markers: ["include/taihen.h", "lib/libtaihen_stub_weak.a", "lib/libtaihenForKernel_stub.a", "lib/libtaihenModuleUtils_stub.a"],
};

export function installDevkitVitaSdk(outdir: string): Promise<string> {
  return installVitaSdkBundle(outdir, [...VITA_RELEASE_SDK_ARCHIVES, TAIHEN_ARCHIVE]);
}

if (import.meta.main) {
  const [outdir] = Bun.argv.slice(2);
  if (!outdir) throw new Error("usage: bun vita/tools/sdk.ts <dir>");
  console.log(await installDevkitVitaSdk(resolve(outdir)));
}

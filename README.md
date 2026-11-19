# Pocket Devkit

Pocket Devkit is the wired development system for PocketJS programs on
devices. Each device has a directory; **`vita/` holds the PS Vita system**: an
installed development container, the Vita program with a USB developer host,
and the computer-side tooling. PocketJS enters as the `vendor/pocketjs`
submodule; this repository builds on its Vita program library
(`pocketjs-vita`), its build tools and its compiler.

## Layout

| Path | Contents |
| --- | --- |
| `vita/app/` | The Pocket Devkit application (`dev.pocket-nexus.devkit`, title `P25BFE5E2`) and its LiveArea art in `vita/app/vita/` |
| `vita/program/` | The Vita program: a binary crate over the `pocketjs-vita` library with the USB developer host (`src/dev.rs`, `src/dev_protocol.rs`, `src/dev_delivery.rs`), the developer menu (`src/devmenu*`) and its frame loop (`src/main.rs`) |
| `vita/tools/` | `vita-dev.ts` (the `bun run vita` commands), the USB mailbox client, the USBHostFS driver and host build (`vita-usb.ts`, `vita-usb/`), the Vita build (`build.ts`) and the SDK pin (`sdk.ts`) |
| `vita/test/` | Host tests: the USB client, the device protocol compiled for the computer, the program lockfile |
| `vendor/pocketjs/` | PocketJS, at the commit this repository is tested against |

## Requirements

- Bun, the version in `.bun-version`, which equals `vendor/pocketjs/.bun-version`.
- Rust through rustup: the nightly and stable compilers
  `vendor/pocketjs/tools/build/toolchains/rust.ts` names (`BUILD_STD_NIGHTLY`
  with `rust-src`, `STABLE_RUST_TOOLCHAIN`).
- VitaSDK with the taiHEN stubs in `$VITASDK`. **`bun vita/tools/sdk.ts <dir>`
  installs PocketJS's pinned release SDK and ports plus a SHA-256-pinned
  taiHEN port** into `<dir>/vitasdk` and prints the path; it supports macOS on
  arm64. Another VitaSDK works when it holds `libtaihen_stub_weak.a`,
  `libtaihenForKernel_stub.a` and `libtaihenModuleUtils_stub.a`.
- CMake and a C compiler for the kernel driver. The first build clones the
  pinned USBHostFS source; later builds use `.pocket-build/toolchains/vita-usb/`.
- For `serve`, the USB host links libusb 0.1 compatibility headers through
  pkg-config: on macOS install `libusb-compat` and `pkgconf` with Homebrew.

```sh
git clone --recurse-submodules https://github.com/pocket-nexus/pocket-devkit.git
cd pocket-devkit
bun run setup     # submodule, vendor/pocketjs packages, node_modules links
bun run check     # type check and host tests
export VITASDK=$(bun vita/tools/sdk.ts ~/vita-sdk | tail -n 1)
export PATH="$VITASDK/bin:$PATH"
```

`setup` links `node_modules/@pocketjs/framework`, `solid-js` and the type
packages to `vendor/pocketjs`, so the application resolves one framework and
one Solid.

## The Vita build

`bun run vita build` compiles `vita/app` into `dist/devkit-main.pkb` with
`pocket compile`, builds `vita/program` around the bundle with PocketJS's
`buildVitaProgram()`, and packages `dist/vita/devkit-main.vpk`:

| VPK path | Source |
| --- | --- |
| `eboot.bin` | `vita/program`, signed as an unsafe-homebrew SELF |
| `pocket-usbhostfs.skprx` | the USBHostFS kernel driver (`vita/tools/vita-usb/`) |
| `sce_sys/icon0.png`, `sce_sys/livearea/contents/*` | `vita/app/vita/` over PocketJS's defaults |
| `sce_sys/param.sfo` | `vita-mksfoex` with the title id |

The build also writes `dist/vita/devkit-main.self` and
`dist/vita/devkit-main.runtime.json`, the development metadata the other
commands read: title, native build identity, resolved plan, project root and
SELF checksum. `--config path/to/pocket.host.config.ts` builds another
application into the same program, `--generic` builds the generic runtime
(no application; the program reads `app0:app.pkb`), and `--title TITLEID`
replaces the title derived from the application id.

**The program crate is its own Cargo graph.** `vita/program/Cargo.toml`
depends on `pocketjs-vita` by path, enables its `guest-deadline` feature, and
carries the profile settings PocketJS applies to its Vita program.
`vita/program/Cargo.lock` resolves every package it shares with
`vendor/pocketjs/Cargo.lock` to the same version, source and checksum;
`vita/test/lockfile.test.ts` checks this. Moving the submodule can require
updating the lockfile from PocketJS's.

## USB transport

**The program enables USB debugging in every build.** The VPK contains the
USBHostFS kernel driver; application launch loads it through taiHEN, which
requires HENkaku's unsafe homebrew permission.

**USB carries updates, status, commands, and framebuffer captures.** There is
no Wi-Fi discovery or wireless fallback. The computer serves an isolated
directory as `host0:`. The app's worker owns every USB filesystem operation;
the rendering thread exchanges one request/reply at a time with that worker.
Successful USB status exchanges reset the display and automatic-suspend idle
timers. Manual suspend remains available; disconnected apps keep the system's
idle behavior.

**Pocket Devkit (`vita/app`, title `P25BFE5E2`) is the development
container.** Install its VPK once. Its screen waits for a build over USB;
`push` replaces its JS/PAK guest and `native` runs another build from its
inactive slot. A native build addresses the container through its title:
build it with `--title P25BFE5E2` and pass that build's `.runtime.json` to
`native`.

## First installation

```sh
bun run vita build
# In VitaShell, enter USB storage mode.
bun run vita install --mount /Volumes/PSV
```

`install` copies `devkit-main.vpk` to `ux0:data/pocketjs-dev/` and compares its
SHA-256 with the source. Eject the storage volume, exit VitaShell's transfer
mode, install the VPK, and open Pocket Devkit from LiveArea. A successful copy
does not establish that the app has launched.

```sh
# Keep this process running in one terminal.
bun run vita serve
# Other terminals:
bun run vita status
bun run vita capture
```

Commands address `--app devkit` unless `--app` names another build's output.
The device enumerates as **`054c:0f01`**, an experimental development ID used
by this driver and its matching host. PSP PSPLINK uses `054c:01c9`, so the
Vita host does not claim a connected PSP. On Linux, give the current user
access to `054c:0f01` through a udev rule. The host build supports macOS and
Linux; Windows driver and host setup is not supplied. `serve` holds the
`vita:usb:transport` device lease and the other commands `vita:usb`
(`vendor/pocketjs/tools/device-lease.ts`).

## Developer menu

**L + R + SELECT opens the native menu.** The host consumes the chord until
release, so the guest does not see its SELECT. While the menu is open, guest
input is cleared and guest rendering continues.

| Input | Action |
| --- | --- |
| Cross | Recreate the active JS guest and its native resources |
| Square | Queue a GXM capture to `menu-capture.rgba` and `menu-capture.json` in the USB share |
| Triangle | Return to the JS/PAK embedded in this native build |
| Circle | Close the menu |

The running `serve` command converts menu captures to PNG and prints the
output path under `.pocket-build/validation/vita-usb/`.

A JavaScript exception leaves the native menu and USB worker available. The
program interrupts JavaScript evaluation after **5 seconds**, or a frame turn
after **250 ms** (`pocketjs-vita` feature `guest-deadline`), to recover from
loops in guest code. The program retains the error text in status. GPU and
native faults can require reopening the LiveArea bubble or rebooting the
device.

**The menu reports driver loading and startup errors.** `0x8002d003` means
a module dependency library is missing. The driver resolves the sysmem export
for the SDK's 3.60 and 3.63 library identifiers at startup; the build rejects
a static import of that library. Startup diagnostics are stored in
`ux0:data/pocketjs-dev/<TITLE_ID>/startup.json` and `driver.json` for retrieval
through VitaShell USB storage when the debug transport cannot connect.

**Status includes battery and free-memory measurements once per second.**
`telemetry` reports battery percentage, charging, external power, low battery,
battery temperature in hundredths of a degree Celsius, and free user, CDRAM
and physically contiguous memory in bytes. The worker writes `health.json`
beside the startup diagnostics every five seconds, including when USB is
disconnected. The latest write can be lost during a power failure; the
snapshot does not identify the cause of a shutdown.

**Status includes `frameTiming`, the frame's CPU time by segment, averaged
over 120 frames, in microseconds.** `advance` is the guest turn and the core
tick, `gpuWait` is `begin_frame` waiting for the previous scene's GPU work,
`render` builds and submits the DrawList, and `frame` is the whole loop
iteration. A frame whose `gpuWait` is most of `frame` is GPU-bound.

## JS and resource updates

```sh
bun run vita push
bun run vita watch
# Or send an existing bundle compiled for the Vita host contract:
bun run vita push --bundle dist/devkit-main.pkb
```

`push` compiles JS/PAK from the build's resolved plan, relative to the
project root its metadata records, and sends one bundle. `watch` watches that
project root; `--watch-dir` selects a different source root. It rebuilds after
a changed file timestamp and sends the bundle after the build succeeds. For a
build made elsewhere, pass `--runtime path/to/app.runtime.json` and
`--project-root path/to/project`. Failed builds or uploads remain pending in
the watcher and are retried after two seconds, including when USB reconnects
without another source edit.

**An update succeeds after the candidate produces its first frame.** The
worker verifies the package checksum, Vita target, host ABI, app ID and
output, and native plan. The render thread retires the previous QuickJS realm,
GPU resources, core, and PAK at a closed-scene boundary. It then creates the
new guest. Failure during evaluation or the first frame restores the previous
bundle in a fresh realm and returns an error. JavaScript state resets; this is
whole-guest reload. The updated bundle remains in memory until reset or
process exit.

The package limit is **32 MiB**. Source paths, title, version, and plan hash
may change without changing native services. Other plan changes require a
native rebuild.

## Native replacement

```sh
bun run vita build --config ../my-app/pocket.host.config.ts --title P25BFE5E2
bun run vita native --runtime dist/vita/my-app-main.runtime.json
```

The metadata file takes the application's `app.output` as its name.

The build emits a VPK, SELF, and `.runtime.json` together. The native command
transfers the SELF over USB, checks its length and checksum, and stages it in
an inactive `pocket-dev-a.self` or `pocket-dev-b.self` slot under this title.
The module manager's loaded SELF path identifies the active slot; an unknown
path rejects the update before either slot is written. After validating the
upload, the worker releases the `app0:` mount to permit writes to that title's
directory. Guest JS/PAK remains in memory. The slot is read back and its
checksum checked before launch. `sceAppMgrLoadExec` starts it through `app0:`.
The replacement contains the program and its embedded JS/PAK. The limit is
**64 MiB**.

**The original `eboot.bin` stays intact.** Reopening the installed LiveArea
bubble starts that recovery build. A native command reports success only
after a status receipt names the new build ID, shows completed frames, and
contains no guest error. A staged file or a restart request is not a success
receipt. Firmware launch errors are returned by the existing process.

The kernel driver remains loaded across native replacement and application
exit. Each process queries the kernel module namespace and reuses a resident
driver before attempting a load. It is not added to `tai/config.txt`;
rebooting unloads it and restores the system's USB mode. Exit the host process
before returning to VitaShell USB storage. If another USB plugin owns the
port, disable that plugin for the development session and reboot before
starting Pocket Devkit.

## Generic runtime

`bun run vita build --generic` builds the generic runtime with the developer
host (cargo feature `runtime`): no embedded app, and the program reads
`app0:app.pkb` at startup. A file the runtime refuses leaves one line on
screen. A runtime that started without a bundle, or with one it refused,
accepts a `push`. A build for the installed container takes its title:

```sh
bun run vita build --generic --title P25BFE5E2
bun run vita native --runtime dist/vita/pocket-runtime.runtime.json --title P25BFE5E2
bun run vita stage --file app.pkb --into app --title P25BFE5E2
bun run vita stage --file game.vpk --title P25BFE5E2
```

**`stage` writes one file to the card.** `--into card` (the default) puts it
in `ux0:data/pocket-runtime/` for VitaShell to install; `--into app` puts
`app.pkb` in the container's own directory, read by the next runtime
process that `native` starts (the running process released its `app0:`
mount to write it). The worker writes the file, reads it back and compares
size and checksum before it replies. The limit is **64 MiB**. The runtime's
`push` admits any bundle whose binding generation and plan the Vita host facts
admit: it has no compiled app id.

## Captures and acceptance

```sh
bun run vita menu
bun run vita capture --out .pocket-build/validation/vita-usb/manual/frame.png
bun run vita reload
bun run vita reset
```

**Captures read the 960 × 544 GXM render buffer after GPU completion.** The
render thread copies RGBA bytes before the next scene can reuse the buffer;
the worker transfers that copy over USB. The computer encodes PNG and writes
a JSON receipt with frame, native build, guest hash, and generation. This
capture includes native overlays and differs from PocketJS's Vita3K CPU golden
path.

The client rejects stale status, session mismatches, concurrent commands,
and incomplete response identities. USB upload failures retain the active
guest. If a command times out, its payload remains in the share for the
in-flight reader; a timeout does not prove that the device applied it.
**A pending request blocks later commands until its completion arrives.**
The device retains completed replies across interrupted writes and sends them
after USB reconnects, without executing the command again. The next command
retires a completed request and its upload. Restarting the host starts a new
session; the client waits for live status from that session before retiring
the previous session's request.

Physical acceptance requires a live status receipt, a changed guest hash
after JS push, a changed native build after SELF replacement, and a decoded
GXM capture from that process. Build and protocol tests do not establish
physical acceptance. Keep per-run results in ignored
`.pocket-build/validation/vita-usb/<run>/`.

## License

MIT; see [LICENSE](LICENSE). The USBHostFS source the build fetches keeps its
upstream notices (`vita/tools/vita-usb/README.md`).

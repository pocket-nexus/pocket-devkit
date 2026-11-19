//! Pocket Devkit's PS Vita program: the pocketjs-vita frame loop with the USB
//! developer host (dev.rs) between frames. Guest updates, native replacement,
//! captures and the developer menu are applied at frame boundaries.
use pocketjs_core::spec;
use pocketjs_vita::{embedded, graphics, input, vita_log, Runtime};
use std::sync::Arc;

mod dev;
mod dev_delivery;
mod dev_protocol;
mod devmenu;

use dev_protocol::{Bundle, Op};
use devmenu::Action;
// dev_protocol.rs admits bundles against the profile the library embeds.
use pocketjs_vita::profile;

#[no_mangle]
#[used]
pub static sceUserMainThreadStackSize: u32 = 2 * 1024 * 1024;

/// Process-global frame identity across guest reloads.
static mut GLOBAL_FRAME: u32 = 0;

fn fail(message: &str) -> ! {
    vita_log(format_args!("[Pocket Devkit] {message}"));
    loop {
        std::thread::yield_now();
    }
}

/// Boot the embedded guest (app0:app.pkb in the generic runtime), or the last
/// admitted USB bundle in its place.
unsafe fn boot_guest(active: &Option<Arc<Bundle>>) -> Result<Runtime, String> {
    let mut runtime = Runtime::new()?;
    // A missing app.pkb must still reach the shutdown below: a `?` here would drop
    // the runtime with its guest still marked active, and every later push would fail.
    let started = if let Some(bundle) = active {
        runtime.eval_package(bundle.package.clone())
    } else {
        embedded::eval(&mut runtime)
    };
    if let Err(error) = started {
        runtime.shutdown();
        return Err(error);
    }
    Ok(runtime)
}

fn embedded_hash() -> String {
    if cfg!(feature = "runtime") || embedded::BUNDLE.is_empty() {
        return "unavailable".into();
    }
    // The development protocol identifies content by JS/pak. Reading them
    // here does not select the bytes used for runtime admission.
    let sections = pocket_package::Bundle::parse(embedded::BUNDLE, false).ok().and_then(|bundle| {
        Some((
            bundle.section(pocket_package::bundle::section::JS).ok()??,
            bundle
                .section(pocket_package::bundle::section::PAK)
                .ok()?
                .unwrap_or(&[]),
        ))
    });
    sections
        .map(|(js, pak)| {
            let js = js.strip_suffix(&[0]).unwrap_or(js);
            format!("{:016x}", pocket_package::fnv1a64(&[js, pak]))
        })
        .unwrap_or_else(|| "unavailable".into())
}

unsafe fn run_guest(dev: &mut dev::Host) -> ! {
    dev.active_hash = embedded_hash();
    dev.error.clear();
    let mut active: Option<Arc<Bundle>> = None;
    let mut runtime = boot_guest(&active)
        .map_err(|e| {
            dev.error = e;
            // The generic runtime shows the one line instead of the menu.
            dev.menu.visible = !cfg!(feature = "runtime");
        })
        .ok();
    // Retain the last admitted bundle until the candidate produces its first frame.
    let mut pending: Option<(Option<dev::Request>, Option<Arc<Bundle>>, String)> = None;

    loop {
        let current_frame = GLOBAL_FRAME;
        let pad = input::read();
        let (buttons, analog, touches) = (
            pad.buttons as i32,
            pad.left_analog(),
            input::read_touches([graphics::LOGICAL_W, graphics::LOGICAL_H]),
        );
        let (filtered, action) = dev.menu.input(buttons as u32);
        let buttons = filtered as i32;
        let touches = if dev.menu.visible {
            input::TouchSnapshot::EMPTY
        } else {
            touches
        };

        let advance_at = pocketjs_vita::frame_timing::now_us();
        if let Some(guest) = runtime.as_mut() {
            let result = guest.frame_with_input(
                buttons,
                if dev.menu.visible {
                    spec::ANALOG_CENTER as i32
                } else {
                    analog
                },
                &touches,
            );
            pocketjs_vita::frame_timing::add(0, pocketjs_vita::frame_timing::now_us() - advance_at);
            if let Err(error) = result {
                runtime.take().unwrap().shutdown();
                if let Some((request, previous, hash)) = pending.take() {
                    active = previous;
                    dev.active_hash = hash;
                    runtime = boot_guest(&active).ok();
                    if let Some(request) = request {
                        request.finish(Err(format!(
                            "candidate frame failed; previous guest restored: {error}"
                        )));
                    }
                }
                dev.error = error;
                dev.menu.visible = true;
            }
        }
        if let Some(guest) = runtime.as_mut() {
            guest.render_with_overlay(|| dev.overlay());
        } else {
            graphics::begin_frame(0xff1c_1410);
            #[cfg(feature = "runtime")]
            if !dev.menu.visible && !dev.error.is_empty() {
                pocketjs_vita::overlay::notice(&dev.error);
            }
            dev.overlay();
            graphics::present();
        }
        if pending.is_some() {
            vita2d_sys::vita2d_wait_rendering_done();
        }
        if let Some((request, _, _)) = pending.take() {
            dev.generation += 1;
            dev.error.clear();
            if let Some(request) = request {
                request.finish(Ok(serde_json::json!({"generation":dev.generation,"bundle":dev.active_hash,"frame":current_frame,"nativeBuild":dev::NATIVE_BUILD})));
            }
        }
        pocketjs_vita::frame_timing::end_frame();
        dev.publish(GLOBAL_FRAME, embedded::OUTPUT);

        let mut request = dev.poll();
        let op = request.as_ref().map(|r| r.command.op).or(match action {
            Action::Reload => Some(Op::Reload),
            Action::Reset => Some(Op::Reset),
            Action::Capture => Some(Op::Capture),
            Action::None => None,
        });
        match op {
            Some(Op::Status) => {
                request
                    .take()
                    .unwrap()
                    .finish(Ok(dev.status(current_frame, embedded::OUTPUT)));
            }
            Some(Op::Menu) => {
                dev.menu.visible = !dev.menu.visible;
                request
                    .take()
                    .unwrap()
                    .finish(Ok(serde_json::json!({"menu":dev.menu.visible})));
            }
            Some(Op::Capture) => {
                if let Some(request) = request.take() {
                    let _ = request.reply.try_send(dev.capture(GLOBAL_FRAME));
                } else {
                    dev.capture_from_menu(GLOBAL_FRAME);
                }
            }
            Some(Op::Push | Op::Reload | Op::Reset) => {
                let previous = active.clone();
                let hash = dev.active_hash.clone();
                if op == Some(Op::Push) {
                    active = request.as_mut().unwrap().bundle.take().map(Arc::new);
                }
                if op == Some(Op::Reset) {
                    active = None;
                }
                if let Some(guest) = runtime.take() {
                    guest.shutdown();
                }
                match boot_guest(&active) {
                    Ok(guest) => {
                        runtime = Some(guest);
                        dev.active_hash = active
                            .as_ref()
                            .map(|b| b.hash.clone())
                            .unwrap_or_else(embedded_hash);
                        pending = Some((request.take(), previous, hash));
                    }
                    Err(error) => {
                        active = previous;
                        runtime = boot_guest(&active).ok();
                        dev.error = error.clone();
                        dev.menu.visible = true;
                        if let Some(request) = request.take() {
                            request.finish(Err(format!(
                                "candidate boot failed; previous guest restored: {error}"
                            )));
                        }
                    }
                }
            }
            Some(Op::Stage) => {
                // The worker wrote and read back the file before this request
                // reached the frame boundary.
                let request = request.take().unwrap();
                let path = dev_protocol::stage_path(&request.command, dev::TITLE_ID);
                request.finish(Ok(serde_json::json!({ "path": path })));
            }
            Some(Op::Native) => {
                let request = request.take().unwrap();
                if let Some(guest) = runtime.take() {
                    guest.shutdown();
                }
                let result = dev::exec_native(request.native_path.as_ref().unwrap());
                runtime = boot_guest(&active).ok();
                request.finish(result.map(|_| serde_json::json!({})));
            }
            None => {}
        }

        GLOBAL_FRAME = GLOBAL_FRAME.wrapping_add(1);
    }
}

fn main() {
    unsafe {
        graphics::init().unwrap_or_else(|error| fail(error));
        input::init();
        let mut dev = dev::Host::new();
        run_guest(&mut dev)
    }
}

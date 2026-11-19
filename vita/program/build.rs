//! The development identity src/dev.rs reports and checks, and the libraries
//! the USB host links beyond the pocketjs-vita library's.
//!
//! vita/tools/build.ts sets the variables: POCKETJS_VITA_PLAN names the
//! resolved build plan a `push` must keep, POCKETJS_VITA_TITLE_ID the title the
//! host addresses, POCKETJS_NATIVE_BUILD a random identity per native build.
use std::{env, fs, path::PathBuf};

fn main() {
    for key in [
        "POCKETJS_VITA_PLAN",
        "POCKETJS_VITA_TITLE_ID",
        "POCKETJS_NATIVE_BUILD",
    ] {
        println!("cargo:rerun-if-env-changed={key}");
    }
    let plan = env::var("POCKETJS_VITA_PLAN").unwrap_or_default();
    let plan_json = if plan.is_empty() {
        "null".into()
    } else {
        println!("cargo:rerun-if-changed={plan}");
        fs::read_to_string(&plan).expect("read the Vita build plan")
    };
    let title_id = env::var("POCKETJS_VITA_TITLE_ID").unwrap_or_default();
    let native_build = env::var("POCKETJS_NATIVE_BUILD").unwrap_or_else(|_| "external".into());
    fs::write(
        PathBuf::from(env::var("OUT_DIR").unwrap()).join("dev_identity.rs"),
        format!(
            "pub const PLAN: &str = {plan_json:?};\npub const TITLE_ID: &str = {title_id:?};\npub const NATIVE_BUILD: &str = {native_build:?};\n"
        ),
    )
    .unwrap();
    // sceAppMgrUmount and sceAppMgrLoadExec: native slots.
    println!("cargo:rustc-link-lib=SceAppMgr_stub");
    // taiLoadStartKernelModuleForUser and _vshKernelSearchModuleByName: the driver.
    println!("cargo:rustc-link-lib=taihen_stub_weak");
    println!("cargo:rustc-link-lib=SceVshBridge_stub");
}

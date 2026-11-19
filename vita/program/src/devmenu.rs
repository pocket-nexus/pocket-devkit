//! The developer menu: L + R + SELECT input handling (devmenu/input.rs). The
//! panel is drawn with pocketjs_vita::overlay, whose firmware font stays
//! outside the guest's UI and pak.
mod input;
pub use input::{Action, Menu};

//! Launching Devtop when the user logs in. The login item passes
//! `MINIMIZED_ARG` so the app starts in the tray instead of opening a window.

use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

pub const MINIMIZED_ARG: &str = "--minimized";

pub fn launched_minimized() -> bool {
    std::env::args().any(|arg| arg == MINIMIZED_ARG)
}

#[tauri::command]
pub fn launch_at_login(app: AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .is_enabled()
        .map_err(|error| error.to_string())
}

/// Turns the login item on or off and returns whether it is now enabled.
#[tauri::command]
pub fn set_launch_at_login(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let launcher = app.autolaunch();
    let result = if enabled {
        launcher.enable()
    } else {
        launcher.disable()
    };
    result
        .and_then(|()| launcher.is_enabled())
        .map_err(|error| error.to_string())
}

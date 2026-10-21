//! The system tray (menu bar on macOS, top bar on Linux) icon and its menu.
//! The interface builds the menu in the user's language and sends it with
//! `update_tray` after every scan; this module only renders it and handles
//! clicks. Closing the window hides it to the tray instead of quitting,
//! unless the user turned that off in the settings.

use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime, State, WindowEvent,
};

const TRAY_ID: &str = "main";

/// Whether closing the window keeps the app running in the tray.
pub struct CloseToTray(AtomicBool);

impl Default for CloseToTray {
    fn default() -> Self {
        Self(AtomicBool::new(true))
    }
}

pub fn available<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.tray_by_id(TRAY_ID).is_some()
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TrayItem {
    /// A clickable entry. `open:<url>`, `show`, and `quit` are handled here;
    /// any other id is forwarded to the interface as a `tray-action` event.
    Action {
        id: String,
        label: String,
    },
    Label {
        label: String,
    },
    Separator,
    Submenu {
        label: String,
        items: Vec<TrayItem>,
    },
}

#[derive(Deserialize)]
pub struct TrayMenu {
    /// Short text next to the icon (Linux and macOS), e.g. the number of services.
    title: Option<String>,
    tooltip: String,
    items: Vec<TrayItem>,
}

/// Adds the tray icon. Desktops without tray support (e.g. GNOME without the
/// AppIndicator extension) simply get no icon; the app keeps working.
pub fn setup<R: Runtime>(app: &AppHandle<R>) {
    let Some(icon) = app.default_window_icon().cloned() else {
        return;
    };
    // A placeholder menu until the interface sends the translated one.
    let result = MenuItem::with_id(app, "show", "Devtop", true, None::<&str>)
        .and_then(|show| Menu::with_items(app, &[&show]))
        .and_then(|menu| {
            TrayIconBuilder::with_id(TRAY_ID)
                .icon(icon)
                .tooltip("Devtop")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| handle_action(app, event.id().as_ref()))
                .on_tray_icon_event(|tray, event| {
                    // Linux opens the menu on any click and reports no click events.
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_window(tray.app_handle());
                    }
                })
                .build(app)
        });
    if let Err(error) = result {
        eprintln!("Tray icon unavailable: {error}");
    }
}

/// Hides the window instead of closing it while the tray icon can bring it back.
pub fn on_window_event<R: Runtime>(window: &tauri::Window<R>, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        let app = window.app_handle();
        if available(app) && app.state::<CloseToTray>().0.load(Ordering::Relaxed) {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}

#[tauri::command]
pub fn set_close_to_tray(state: State<CloseToTray>, enabled: bool) {
    state.0.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
pub fn update_tray(app: AppHandle, menu: TrayMenu) -> Result<(), String> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    let items = build_items(&app, &menu.items).map_err(|error| error.to_string())?;
    let refs: Vec<&dyn IsMenuItem<_>> = items.iter().map(|item| item.as_ref()).collect();
    let built = Menu::with_items(&app, &refs).map_err(|error| error.to_string())?;
    tray.set_menu(Some(built))
        .and_then(|()| tray.set_tooltip(Some(&menu.tooltip)))
        .and_then(|()| tray.set_title(menu.title.as_deref()))
        .map_err(|error| error.to_string())
}

/// Menu labels treat `&` as a mnemonic marker; show it literally instead.
fn literal(label: &str) -> String {
    label.replace('&', "&&")
}

fn build_items<R: Runtime>(
    app: &AppHandle<R>,
    items: &[TrayItem],
) -> tauri::Result<Vec<Box<dyn IsMenuItem<R>>>> {
    items
        .iter()
        .map(|item| -> tauri::Result<Box<dyn IsMenuItem<R>>> {
            Ok(match item {
                TrayItem::Action { id, label } => Box::new(MenuItem::with_id(
                    app,
                    id.as_str(),
                    literal(label),
                    true,
                    None::<&str>,
                )?),
                TrayItem::Label { label } => {
                    Box::new(MenuItem::new(app, literal(label), false, None::<&str>)?)
                }
                TrayItem::Separator => Box::new(PredefinedMenuItem::separator(app)?),
                TrayItem::Submenu { label, items } => {
                    let children = build_items(app, items)?;
                    let refs: Vec<&dyn IsMenuItem<R>> =
                        children.iter().map(|child| child.as_ref()).collect();
                    Box::new(Submenu::with_items(app, literal(label), true, &refs)?)
                }
            })
        })
        .collect()
}

fn handle_action<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        "show" => show_window(app),
        "quit" => app.exit(0),
        _ => {
            if let Some(url) = id.strip_prefix("open:") {
                if url.starts_with("http://") || url.starts_with("https://") {
                    let _ = tauri_plugin_opener::open_url(url, None::<&str>);
                }
            } else {
                let _ = app.emit("tray-action", id);
            }
        }
    }
}

pub fn show_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

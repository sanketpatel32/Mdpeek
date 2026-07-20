mod commands;
mod watcher;

use serde::Serialize;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, Emitter,
};
use watcher::WatcherState;

/// Holds the most recent file path passed on the command line (either at launch
/// or when a second instance opens a file). The frontend pulls it on startup
/// via `get_initial_file`, and listens for the `open-file` event thereafter.
#[derive(Default)]
struct PendingFile(pub Mutex<Option<String>>);

#[derive(Serialize, Clone)]
struct FilePayload {
    path: String,
    content: String,
    is_dir: bool,
}

/// Read a file for the frontend. PDFs are binary and can't be decoded as UTF-8,
/// so we return empty content for them — the JS side detects PDFs by path and
/// loads them via the asset protocol instead of through `content`.
fn read_file_for_frontend(path: &str) -> Result<FilePayload, String> {
    let is_dir = std::path::Path::new(path).is_dir();
    if is_dir {
        return Ok(FilePayload {
            path: path.to_string(),
            content: String::new(),
            is_dir: true,
        });
    }
    if path.to_lowercase().ends_with(".pdf") {
        return Ok(FilePayload {
            path: path.to_string(),
            content: String::new(),
            is_dir: false,
        });
    }
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    Ok(FilePayload {
        path: path.to_string(),
        content,
        is_dir: false,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        // Single-instance: a second launch focuses this window and forwards its
        // argv (e.g. a double-clicked .md) as an `open-file` event to the
        // frontend, which opens it as a new tab instead of a new window.
        builder = builder.plugin(
            tauri_plugin_single_instance::init(|app, argv, _cwd| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    // argv[0] is the exe; argv[1] (if present) is the file path.
                    if argv.len() > 1 {
                        let path = argv[1].clone();
                        if let Ok(payload) = read_file_for_frontend(&path) {
                            let _ = window.emit("open-file", payload);
                        }
                    }
                }
            }),
        );
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    // Seed pending file from argv at launch (Windows passes the .md path as argv[1]
    // when the user double-clicks a file with mdpeek set as default).
    let initial: PendingFile = {
        let args: Vec<String> = std::env::args().collect();
        PendingFile(Mutex::new(if args.len() > 1 { Some(args[1].clone()) } else { None }))
    };

    builder
        .plugin(tauri_plugin_opener::init())
        .manage(WatcherState::default())
        .manage(initial)
        .setup(|app| {
            // ---------- System tray ----------
            // Tray icon: left-click shows the window, right-click opens a menu
            // with Show / Quit. The icon reuses the app icon.
            let show_item = MenuItem::with_id(app, "show", "Show mdpeek", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit mdpeek", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("mdpeek")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Double-click (or single-click-release) on the tray icon
                    // shows + focuses the window.
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Intercept the close button. Instead of exiting, emit an event to
            // the frontend, which decides (based on the user's preference)
            // whether to minimize to tray or actually quit.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.emit("close-requested", ());
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_file,
            commands::save_file,
            commands::save_file_as,
            commands::save_file_as_html,
            commands::read_file,
            commands::save_image,
            commands::save_annotated_image,
            commands::pick_folder,
            commands::list_dir,
            commands::search_in_folder,
            commands::register_context_menu,
            commands::unregister_context_menu,
            commands::is_context_menu_registered,
            watcher::watch_path,
            get_initial_file,
            hide_to_tray,
            quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running mdpeek");
}

/// Hide the window to the system tray (called by the frontend when the user
/// picks "Minimize to tray" in the close dialog, or when "always minimize"
/// is the saved preference).
#[tauri::command]
fn hide_to_tray(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    Ok(())
}

/// Actually quit the app (called by the frontend when the user picks "Quit").
#[tauri::command]
fn quit_app(app: tauri::AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

/// Frontend calls this once on startup to pull any file passed at launch.
/// Returns None if mdpeek was launched without a file argument.
#[tauri::command]
fn get_initial_file(state: tauri::State<PendingFile>) -> Result<Option<FilePayload>, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(path) = guard.take() {
        match read_file_for_frontend(&path) {
            Ok(payload) => Ok(Some(payload)),
            Err(e) => Err(format!("Could not read {}: {}", path, e)),
        }
    } else {
        Ok(None)
    }
}


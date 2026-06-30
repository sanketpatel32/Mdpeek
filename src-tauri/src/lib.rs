mod commands;
mod watcher;

use serde::Serialize;
use std::sync::Mutex;
use watcher::WatcherState;

/// Holds the most recent file path passed on the command line (either at launch
/// or when a second instance opens a file). The frontend pulls it on startup
/// via `get_initial_file`, and listens for the `open-file` event thereafter.
#[derive(Default)]
struct PendingFile(pub Mutex<Option<String>>);

#[derive(Serialize)]
struct FilePayload {
    path: String,
    content: String,
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
                use tauri::{Manager, Emitter};
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    // argv[0] is the exe; argv[1] (if present) is the file path.
                    if argv.len() > 1 {
                        let path = argv[1].clone();
                        if let Ok(content) = std::fs::read_to_string(&path) {
                            let payload = serde_json::json!({ "path": path, "content": content });
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
        .invoke_handler(tauri::generate_handler![
            commands::open_file,
            commands::save_file,
            commands::save_file_as,
            commands::read_file,
            watcher::watch_path,
            get_initial_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running mdpeek");
}

/// Frontend calls this once on startup to pull any file passed at launch.
/// Returns None if mdpeek was launched without a file argument.
#[tauri::command]
fn get_initial_file(state: tauri::State<PendingFile>) -> Result<Option<FilePayload>, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(path) = guard.take() {
        match std::fs::read_to_string(&path) {
            Ok(content) => Ok(Some(FilePayload { path, content })),
            Err(e) => Err(format!("Could not read {}: {}", path, e)),
        }
    } else {
        Ok(None)
    }
}


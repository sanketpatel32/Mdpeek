mod commands;
mod watcher;

use tauri::{Emitter, Manager};
use watcher::WatcherState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .manage(WatcherState::default())
        .invoke_handler(tauri::generate_handler![
            commands::open_file,
            commands::save_file,
            commands::save_file_as,
            watcher::watch_path,
        ])
        .setup(|app| {
            // If launched by double-clicking a .md (or "Open with"), Windows passes
            // the file path as argv[1]. Read it and forward path + content to the frontend.
            let args: Vec<String> = std::env::args().collect();
            if args.len() > 1 {
                let path = args[1].clone();
                if let Ok(content) = std::fs::read_to_string(&path) {
                    let payload = serde_json::json!({ "path": path, "content": content });
                    let main_window = app
                        .get_webview_window("main")
                        .ok_or_else(|| Box::<dyn std::error::Error>::from("main window not found"))?;
                    main_window.emit("open-file", payload)?;
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running mdpeek");
}

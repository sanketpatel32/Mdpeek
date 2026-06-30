mod commands;
mod watcher;

use watcher::WatcherState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(WatcherState::default())
        .invoke_handler(tauri::generate_handler![
            commands::open_file,
            commands::save_file,
            commands::save_file_as,
            watcher::watch_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running mdpeek");
}

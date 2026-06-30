use notify::{EventKind, RecommendedWatcher, Watcher};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

pub struct WatcherState(pub Mutex<Option<RecommendedWatcher>>);

impl Default for WatcherState {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

#[tauri::command]
pub fn watch_path(app: AppHandle, path: String) -> Result<(), String> {
    let pathbuf = PathBuf::from(&path);
    let state = app.state::<WatcherState>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    // drop previous watcher
    *guard = None;

    let app_handle = app.clone();
    let watched = pathbuf.clone();
    let mut watcher = notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
        if let Ok(event) = res {
            if matches!(event.kind, EventKind::Modify(_)) {
                if let Ok(content) = std::fs::read_to_string(&watched) {
                    let _ = app_handle.emit("file-changed", content);
                }
            }
        }
    })
    .map_err(|e| e.to_string())?;

    watcher
        .watch(&pathbuf, notify::RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    *guard = Some(watcher);
    Ok(())
}

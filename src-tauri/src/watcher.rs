use notify::{EventKind, RecommendedWatcher, Watcher};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

pub struct WatcherState(pub Mutex<Option<RecommendedWatcher>>);

#[derive(Clone, serde::Serialize)]
struct FileChange {
    path: String,
    content: String,
}

impl Default for WatcherState {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

#[tauri::command]
pub fn watch_path(app: AppHandle, path: Option<String>) -> Result<(), String> {
    let state = app.state::<WatcherState>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    // drop previous watcher
    *guard = None;
    let Some(path) = path else {
        return Ok(());
    };
    let pathbuf = PathBuf::from(&path);

    let app_handle = app.clone();
    let watched = pathbuf.clone();
    let mut watcher =
        notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
            if let Ok(event) = res {
                if matches!(event.kind, EventKind::Modify(_)) {
                    if let Ok(content) = std::fs::read_to_string(&watched) {
                        let _ = app_handle.emit(
                            "file-changed",
                            FileChange {
                                path: path.clone(),
                                content,
                            },
                        );
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

#[cfg(test)]
mod tests {
    use super::FileChange;

    #[test]
    fn file_change_identifies_its_source_for_tab_routing() {
        let event = FileChange {
            path: "C:\\notes\\first.md".into(),
            content: "external edit".into(),
        };
        assert_eq!(
            serde_json::to_value(event).unwrap(),
            serde_json::json!({ "path": "C:\\notes\\first.md", "content": "external edit" })
        );
    }
}

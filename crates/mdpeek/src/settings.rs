use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SessionState {
    #[serde(default)]
    pub open_paths: Vec<PathBuf>,
    #[serde(default)]
    pub active: usize,
    #[serde(default)]
    pub root_dir: Option<PathBuf>,
    #[serde(default = "default_sidebar")]
    pub sidebar_visible: bool,
    #[serde(default)]
    pub dark_mode: bool,
}

impl Default for SessionState {
    fn default() -> Self {
        Self {
            open_paths: Vec::new(),
            active: 0,
            root_dir: None,
            sidebar_visible: true,
            dark_mode: false,
        }
    }
}

fn default_sidebar() -> bool {
    true
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AppSettings {
    #[serde(default = "default_true")]
    pub editor_line_numbers: bool,
    #[serde(default = "default_true")]
    pub editor_word_wrap: bool,
    #[serde(default)]
    pub autosave: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            editor_line_numbers: true,
            editor_word_wrap: true,
            autosave: false,
        }
    }
}

fn default_true() -> bool {
    true
}

pub fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

pub fn load_settings() -> AppSettings {
    std::fs::read_to_string(settings_path())
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

pub fn save_settings(settings: &AppSettings) -> std::io::Result<()> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir)?;
    let json = serde_json::to_string_pretty(settings).expect("settings serialize");
    std::fs::write(settings_path(), json)
}

pub fn config_dir() -> PathBuf {
    if let Some(path) = std::env::var_os("LOCALAPPDATA") {
        return PathBuf::from(path).join("mdpeek");
    }
    if let Some(path) = std::env::var_os("XDG_CONFIG_HOME") {
        return PathBuf::from(path).join("mdpeek");
    }
    if let Some(path) = std::env::var_os("HOME") {
        return PathBuf::from(path).join(".config").join("mdpeek");
    }
    std::env::temp_dir().join("mdpeek")
}

pub fn session_path() -> PathBuf {
    config_dir().join("session.json")
}

pub fn load_session() -> SessionState {
    std::fs::read_to_string(session_path())
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

pub fn save_session(state: &SessionState) -> std::io::Result<()> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir)?;
    let json = serde_json::to_string_pretty(state).expect("session state serializes");
    std::fs::write(session_path(), json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_default_to_readable_editing() {
        let settings = AppSettings::default();
        assert!(settings.editor_line_numbers);
        assert!(settings.editor_word_wrap);
        assert!(!settings.autosave);
    }

    #[test]
    fn session_defaults_are_empty_with_sidebar_visible() {
        let state = SessionState::default();
        assert!(state.open_paths.is_empty());
        assert!(state.sidebar_visible);
    }
}

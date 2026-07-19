use serde::Serialize;
use std::fs;

#[derive(Serialize)]
pub struct OpenResult {
    pub path: String,
    pub content: String,
}

#[tauri::command]
pub async fn open_file() -> Result<OpenResult, String> {
    let file = rfd::AsyncFileDialog::new()
        .add_filter("Markdown", &["md", "markdown", "mdx"])
        .add_filter("Text", &["txt", "log"])
        .add_filter("Code & Config", &[
            "js", "mjs", "cjs", "ts", "tsx", "jsx", "json", "css", "scss", "less",
            "html", "htm", "xml", "svg", "vue", "svelte", "yml", "yaml", "toml",
            "ini", "cfg", "conf", "env", "sh", "bash", "py", "rb", "go", "rs",
            "java", "c", "h", "cpp", "cs", "php", "swift", "kt", "scala", "sql",
            "graphql", "proto", "lua", "r", "dart", "csv", "tsv", "diff", "patch",
        ])
        .add_filter("PDF", &["pdf"])
        .add_filter("Excalidraw", &["excalidraw"])
        .add_filter("All files", &["*"])
        .pick_file()
        .await
        .ok_or_else(|| "cancelled".to_string())?;

    let path = file.path().to_path_buf();
    let path_str = path.display().to_string();
    // PDFs are binary — return empty content; the frontend loads them via the
    // asset protocol instead of through `content`.
    let content = if path_str.to_lowercase().ends_with(".pdf") {
        String::new()
    } else {
        fs::read_to_string(&path).map_err(|e| e.to_string())?
    };
    Ok(OpenResult {
        path: path_str,
        content,
    })
}

#[tauri::command]
pub fn save_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn save_file_as(content: String) -> Result<String, String> {
    let file = rfd::AsyncFileDialog::new()
        .add_filter("Markdown", &["md", "markdown"])
        .set_file_name("untitled.md")
        .save_file()
        .await
        .ok_or_else(|| "cancelled".to_string())?;

    let path = file.path().to_path_buf();
    let path_str = path.display().to_string();
    fs::write(&path, &content).map_err(|e| e.to_string())?;
    Ok(path_str)
}

/// Export the rendered markdown as a self-contained HTML file. Shows a save
/// dialog filtered to .html; returns the saved path or rejects with "cancelled".
#[tauri::command]
pub async fn save_file_as_html(content: String) -> Result<String, String> {
    let file = rfd::AsyncFileDialog::new()
        .add_filter("HTML", &["html", "htm"])
        .set_file_name("exported.html")
        .save_file()
        .await
        .ok_or_else(|| "cancelled".to_string())?;

    let path = file.path().to_path_buf();
    let path_str = path.display().to_string();
    fs::write(&path, &content).map_err(|e| e.to_string())?;
    Ok(path_str)
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    // PDFs are binary — return empty; the frontend never calls this for PDFs
    // (session restore skips the re-read for PDF paths), but guard anyway.
    if path.to_lowercase().ends_with(".pdf") {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Write pasted/dropped image bytes to disk. The frontend passes a target
/// directory (the markdown file's `assets/` folder) and a filename; this
/// creates the directory if needed, writes the bytes, and returns the relative
/// path that should be inserted into the markdown (e.g. `assets/foo-abc.png`).
#[tauri::command]
pub fn save_image(dir: String, filename: String, bytes: Vec<u8>) -> Result<String, String> {
    let dir_path = std::path::Path::new(&dir);
    if !dir_path.exists() {
        fs::create_dir_all(dir_path).map_err(|e| e.to_string())?;
    }
    let full = dir_path.join(&filename);
    fs::write(&full, &bytes).map_err(|e| e.to_string())?;
    // Return the filename only — the markdown image path is relative to the
    // doc's own directory, so `assets/<name>` is correct and portable.
    Ok(filename)
}

/// Show a folder picker. Returns the chosen absolute path, or rejects with
/// "cancelled" when the user dismisses the dialog. Used by the Daily Note
/// feature to pick where dated .md files get written.
#[tauri::command]
pub async fn pick_folder() -> Result<String, String> {
    let folder = rfd::AsyncFileDialog::new()
        .pick_folder()
        .await
        .ok_or_else(|| "cancelled".to_string())?;
    Ok(folder.path().display().to_string())
}

/// One entry inside a listed directory — used by the file-tree sidebar.
#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// List the immediate children of `path`. Directories come first, then files,
/// both alphabetical (case-insensitive). Hidden entries (dot-prefixed on Unix,
/// or with the Windows hidden attribute) and a curated set of noisy folders
/// (node_modules, .git, target, dist, build) are filtered out — the tree is
/// meant for browsing notes/docs, not a full file manager.
#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut dirs: Vec<DirEntry> = Vec::new();
    let mut files: Vec<DirEntry> = Vec::new();
    let entries = fs::read_dir(&path).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy().to_string();
        // Skip dotfiles (covers .git, .DS_Store, .vscode, etc.).
        if name.starts_with('.') {
            continue;
        }
        // Skip noisy build/dep folders that are never useful in a notes tree.
        const SKIP_DIRS: &[&str] = &["node_modules", "target", "dist", "build", "__pycache__"];
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        if meta.is_dir() {
            if SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            dirs.push(DirEntry { name, path: entry.path().display().to_string(), is_dir: true });
        } else {
            files.push(DirEntry { name, path: entry.path().display().to_string(), is_dir: false });
        }
    }
    let by_name = |a: &DirEntry, b: &DirEntry| a.name.to_lowercase().cmp(&b.name.to_lowercase());
    dirs.sort_by(by_name);
    files.sort_by(by_name);
    dirs.append(&mut files);
    Ok(dirs)
}

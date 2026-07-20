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
        .add_filter("Images", &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"])
        .add_filter("Excalidraw", &["excalidraw"])
        .add_filter("All files", &["*"])
        .pick_file()
        .await
        .ok_or_else(|| "cancelled".to_string())?;

    let path = file.path().to_path_buf();
    let path_str = path.display().to_string();
    // PDFs and images are binary — return empty content; the frontend loads
    // them via the asset protocol instead of through `content`.
    let lower = path_str.to_lowercase();
    let is_binary = lower.ends_with(".pdf")
        || lower.ends_with(".png") || lower.ends_with(".jpg") || lower.ends_with(".jpeg")
        || lower.ends_with(".gif") || lower.ends_with(".webp") || lower.ends_with(".svg")
        || lower.ends_with(".bmp") || lower.ends_with(".ico") || lower.ends_with(".avif");
    let content = if is_binary {
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
    // PDFs and images are binary — return empty; the frontend never calls
    // this for them (session restore skips the re-read), but guard anyway.
    const BINARY_EXTS: &[&str] = &[
        ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".avif",
    ];
    let lower = path.to_lowercase();
    if BINARY_EXTS.iter().any(|ext| lower.ends_with(ext)) {
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

/// Save an annotated image (the original image with strokes composited on
/// top, produced by the frontend via canvas.toBlob). Pops a save dialog
/// filtered to .png, writes the bytes, and returns the absolute saved path.
/// Rejects with "cancelled" if the user dismisses the dialog.
#[tauri::command]
pub async fn save_annotated_image(bytes: Vec<u8>, suggested_name: String) -> Result<String, String> {
    let file = rfd::AsyncFileDialog::new()
        .add_filter("PNG image", &["png"])
        .set_file_name(&suggested_name)
        .save_file()
        .await
        .ok_or_else(|| "cancelled".to_string())?;
    let path = file.path().to_path_buf();
    let path_str = path.display().to_string();
    fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path_str)
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

// ---------- folder-wide search ----------

/// Single-line match inside a file.
#[derive(Serialize, Clone)]
pub struct SearchMatch {
    pub line: u32,          // 1-based line number
    pub column: u32,        // 0-based column of the first match on the line
    pub text: String,       // the matching line, trimmed + capped at 300 chars
    pub match_start: usize, // byte offset of the first match within `text`
    pub match_end: usize,   // byte offset after the last match byte
}

/// All matches within a single file.
#[derive(Serialize)]
pub struct FileSearchResult {
    pub path: String,
    pub matches: Vec<SearchMatch>,
}

/// Top-level result returned by `search_in_folder`.
#[derive(Serialize)]
pub struct SearchSummary {
    pub results: Vec<FileSearchResult>, // sorted by path, only files with matches
    pub truncated: bool,                // true if any cap was hit
    pub total_matches: usize,
    pub files_scanned: usize,           // text files actually scanned
    pub files_with_matches: usize,
}

// Directories to skip during the recursive walk — same list as `list_dir`'s
// SKIP_DIRS, kept in sync so search results match what the tree shows.
const SEARCH_SKIP_DIRS: &[&str] = &["node_modules", "target", "dist", "build", "__pycache__"];

// Extensions that are virtually always binary — never opened as text. Extends
// the BINARY_EXTS list used by `read_file` with archive/media/font/binary
// formats so search doesn't waste time decoding (and polluting results with)
// files that aren't greppable.
const SEARCH_BINARY_EXTS: &[&str] = &[
    "pdf", "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif",
    "zip", "gz", "tar", "tgz", "rar", "7z", "bz2", "xz",
    "exe", "dll", "so", "dylib", "class", "jar", "wasm", "o", "a",
    "mp3", "mp4", "mov", "avi", "mkv", "ogg", "wav", "flac", "webm",
    "woff", "woff2", "ttf", "otf", "eot",
    "excalidraw", "ipynb",
    "db", "sqlite", "sqlite3", "pak",
];

fn search_is_binary_ext(path: &str) -> bool {
    let lower = path.to_lowercase();
    SEARCH_BINARY_EXTS.iter().any(|ext| {
        lower.ends_with(&format!(".{}", ext)) ||
        // Basename match for extensionless files (e.g. "Dockerfile" — not binary,
        // but be defensive against lockfile-style binary-ish names).
        std::path::Path::new(&lower)
            .file_name()
            .map(|n| n.to_string_lossy().as_ref() == *ext)
            .unwrap_or(false)
    })
}

// Read up to `cap` bytes and reject if a NUL byte appears in the prefix —
// classic `grep -I` heuristic for skipping binaries that slipped past the
// extension check.
fn search_looks_binary(path: &std::path::Path) -> bool {
    use std::io::Read;
    let mut file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return true, // treat unreadable as "skip"
    };
    let mut buf = [0u8; 8192];
    let n = match file.read(&mut buf) {
        Ok(n) => n,
        Err(_) => return true,
    };
    buf[..n].iter().any(|&b| b == 0)
}

// Trim leading/trailing whitespace + cap the line so a single very-long line
// doesn't bloat the payload. Returns (trimmed_text, trim_offset) so the JS
// side can recompute match positions relative to the trimmed string.
fn trim_and_cap(line: &str, cap: usize) -> (String, usize) {
    let trimmed = line.trim();
    // If the trimmed line fits, no capping needed.
    let char_count = trimmed.chars().count();
    if char_count <= cap {
        return (trimmed.to_string(), 0);
    }
    // Cap by characters (not bytes) to avoid splitting a multi-byte sequence.
    let kept: String = trimmed.chars().take(cap).collect();
    // We don't try to preserve original byte offsets across the trim+cap;
    // the caller recomputes match positions on the returned text directly.
    (kept + "…", 0)
}

/// Recursively grep `query` across every text file under `root`. Returns
/// matches grouped by file, sorted by path. Plain substring search (case-
/// sensitive toggle); regex would require adding the `regex` crate, deferred.
///
/// Caps: `max_results` total matches (default 1000) and 200 files with
/// matches — when either is hit, `truncated = true` so the UI can surface a
/// "narrow your search" hint.
#[tauri::command]
pub fn search_in_folder(
    root: String,
    query: String,
    case_sensitive: bool,
    max_results: Option<usize>,
) -> Result<SearchSummary, String> {
    // Empty query → empty result. The JS side debounces, but guard anyway.
    if query.is_empty() {
        return Ok(SearchSummary {
            results: Vec::new(),
            truncated: false,
            total_matches: 0,
            files_scanned: 0,
            files_with_matches: 0,
        });
    }
    let max_matches = max_results.unwrap_or(1000);
    const MAX_FILES_WITH_MATCHES: usize = 200;
    let needle = if case_sensitive { query.clone() } else { query.to_lowercase() };

    let mut results: Vec<FileSearchResult> = Vec::new();
    let mut total_matches = 0usize;
    let mut files_scanned = 0usize;
    let mut truncated = false;

    // Explicit stack to avoid recursion limits on deep trees.
    let mut stack: Vec<std::path::PathBuf> = vec![std::path::PathBuf::from(&root)];
    while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue, // skip unreadable directories silently
        };
        for entry in entries.flatten() {
            // Stop early once limits are hit.
            if total_matches >= max_matches || results.len() >= MAX_FILES_WITH_MATCHES {
                truncated = true;
                break;
            }
            let file_name = entry.file_name();
            let name = file_name.to_string_lossy().to_string();
            // Same dotfile + skip-dir rules as `list_dir`.
            if name.starts_with('.') {
                continue;
            }
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.is_dir() {
                if SEARCH_SKIP_DIRS.contains(&name.as_str()) {
                    continue;
                }
                stack.push(entry.path());
                continue;
            }
            // Skip files with binary extensions.
            let path_str = entry.path().display().to_string();
            if search_is_binary_ext(&path_str) {
                continue;
            }
            // Skip files that look binary (NUL in the first 8 KB).
            if search_looks_binary(&entry.path()) {
                continue;
            }
            // Read + decode. Lossy conversion means invalid UTF-8 becomes U+FFFD
            // but the search still works on the valid portions.
            let bytes = match fs::read(entry.path()) {
                Ok(b) => b,
                Err(_) => continue,
            };
            files_scanned += 1;
            let content = String::from_utf8_lossy(&bytes);
            let mut file_matches: Vec<SearchMatch> = Vec::new();
            for (i, line) in content.lines().enumerate() {
                if total_matches + file_matches.len() >= max_matches {
                    truncated = true;
                    break;
                }
                let haystack = if case_sensitive { line.to_string() } else { line.to_lowercase() };
                // Find the first match on the line (one match per line keeps the
                // UI scannable; multi-match-per-line is overkill for v0.18.0).
                if let Some(idx) = haystack.find(&needle) {
                    let (text, _trim_off) = trim_and_cap(line, 300);
                    // Recompute the match offset on the trimmed text. The trim
                    // may have shifted the position; find again on the lowercased
                    // trimmed version.
                    let trimmed_lower = if case_sensitive { text.clone() } else { text.to_lowercase() };
                    let (match_start, match_end) = match trimmed_lower.find(&needle) {
                        Some(start) => (start, start + needle.len().min(trimmed_lower.len() - start)),
                        None => (0, 0), // trim shifted the match out of view — rare, degrade gracefully
                    };
                    file_matches.push(SearchMatch {
                        line: (i + 1) as u32,
                        column: idx as u32,
                        text,
                        match_start,
                        match_end,
                    });
                }
            }
            if !file_matches.is_empty() {
                total_matches += file_matches.len();
                results.push(FileSearchResult { path: path_str, matches: file_matches });
                if results.len() >= MAX_FILES_WITH_MATCHES {
                    truncated = true;
                }
            }
        }
        if truncated {
            break;
        }
    }

    // Sort by path so the result list reads top-to-bottom through the tree.
    results.sort_by(|a, b| a.path.cmp(&b.path));
    let files_with_matches = results.len();
    Ok(SearchSummary {
        results,
        truncated,
        total_matches,
        files_scanned,
        files_with_matches,
    })
}

#[tauri::command]
pub fn register_context_menu() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let exe_path = std::env::current_exe()
            .map_err(|e| format!("Failed to get executable path: {}", e))?;
        let exe_str = exe_path.to_string_lossy().into_owned();

        // 1. File association (*\shell\mdpeek)
        let file_key = r"HKCU\Software\Classes\*\shell\mdpeek";
        let file_cmd_key = r"HKCU\Software\Classes\*\shell\mdpeek\command";
        
        run_reg_add(file_key, "", "Open with mdpeek")?;
        run_reg_add(file_key, "Icon", &exe_str)?;
        run_reg_add(file_cmd_key, "", &format!("\"{}\" \"%1\"", exe_str))?;

        // 2. Directory association (Directory\shell\mdpeek)
        let dir_key = r"HKCU\Software\Classes\Directory\shell\mdpeek";
        let dir_cmd_key = r"HKCU\Software\Classes\Directory\shell\mdpeek\command";
        
        run_reg_add(dir_key, "", "Open folder in mdpeek")?;
        run_reg_add(dir_key, "Icon", &exe_str)?;
        run_reg_add(dir_cmd_key, "", &format!("\"{}\" \"%1\"", exe_str))?;
    }
    Ok(())
}

#[tauri::command]
pub fn unregister_context_menu() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let file_key = r"HKCU\Software\Classes\*\shell\mdpeek";
        let dir_key = r"HKCU\Software\Classes\Directory\shell\mdpeek";
        
        run_reg_delete(file_key)?;
        run_reg_delete(dir_key)?;
    }
    Ok(())
}

#[tauri::command]
pub fn is_context_menu_registered() -> bool {
    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("reg")
            .args(&["query", r"HKCU\Software\Classes\*\shell\mdpeek"])
            .output();
        
        match output {
            Ok(out) => out.status.success(),
            Err(_) => false,
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

#[cfg(target_os = "windows")]
fn run_reg_add(key: &str, value_name: &str, value_data: &str) -> Result<(), String> {
    let mut args = vec!["add", key];
    if !value_name.is_empty() {
        args.push("/v");
        args.push(value_name);
    } else {
        args.push("/ve");
    }
    args.push("/d");
    args.push(value_data);
    args.push("/f");

    let output = std::process::Command::new("reg")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run reg: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("reg add failed: {}", stderr));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn run_reg_delete(key: &str) -> Result<(), String> {
    let output = std::process::Command::new("reg")
        .args(&["delete", key, "/f"])
        .output()
        .map_err(|e| format!("Failed to run reg: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // If key doesn't exist, it's fine, don't return error
        if !stderr.contains("The system was unable to find the specified registry key or value") {
            return Err(format!("reg delete failed: {}", stderr));
        }
    }
    Ok(())
}

// ============================================================================
// File operations for the explorer (Delete / Rename / Copy / Move)
// ============================================================================
//
// These back the right-click Cut / Copy / Paste / Rename / Delete actions in
// the file-tree context menu. Conventions:
//   - Delete → OS trash (recoverable via the Recycle Bin), never permanent.
//   - Copy/Move into a directory never overwrite: a non-colliding destination
//     name is chosen via unique_name() (e.g. "foo (copy).md", "foo (copy 2).md").
//   - All commands take absolute paths and validate existence before acting.

/// Move a file or directory (recursively) to the OS trash. Recoverable.
#[tauri::command]
pub async fn delete_path(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    // trash::delete works on both files and directories; no need to distinguish.
    trash::delete(&path).map_err(|e| format!("Failed to move to trash: {}", e))
}

/// Rename / move a single file or directory to a new full path. Fails if the
/// destination already exists (we never overwrite). Returns the new path.
#[tauri::command]
pub async fn rename_path(from: String, to: String) -> Result<String, String> {
    let from_p = std::path::Path::new(&from);
    let to_p = std::path::Path::new(&to);
    if !from_p.exists() {
        return Err(format!("Source does not exist: {}", from));
    }
    if to_p.exists() {
        return Err(format!("Destination already exists: {}", to));
    }
    // Create the parent of `to` if missing (rare — usually the same dir).
    if let Some(parent) = to_p.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::rename(&from, &to).map_err(|e| format!("Rename failed: {}", e))?;
    Ok(to)
}

/// Copy a file OR directory (recursively) into `dst_dir`. The destination
/// name is uniquified so it never overwrites. Returns the final full path.
#[tauri::command]
pub async fn copy_path(src: String, dst_dir: String) -> Result<String, String> {
    let src_p = std::path::Path::new(&src);
    if !src_p.exists() {
        return Err(format!("Source does not exist: {}", src));
    }
    let dst_dir_p = std::path::Path::new(&dst_dir);
    if !dst_dir_p.is_dir() {
        return Err(format!("Destination is not a directory: {}", dst_dir));
    }
    let src_name = src_p
        .file_name()
        .ok_or_else(|| "Source has no file name".to_string())?
        .to_string_lossy()
        .to_string();
    let final_name = unique_name(&dst_dir, &src_name);
    let final_path = dst_dir_p.join(&final_name);
    if src_p.is_dir() {
        copy_dir_recursive(src_p, &final_path)
            .map_err(|e| format!("Directory copy failed: {}", e))?;
    } else {
        fs::copy(src_p, &final_path).map_err(|e| format!("File copy failed: {}", e))?;
    }
    // to_string_lossy is fine here — paths from the tree are valid UTF-8 on
    // Windows (the picker wouldn't have produced them otherwise).
    Ok(final_path.to_string_lossy().to_string())
}

/// Move a file OR directory into `dst_dir` (used by Cut → Paste). Tries a
/// fast atomic rename first; falls back to copy+trash on cross-volume moves
/// (rare on Windows but possible). Destination is uniquified. Returns the
/// final full path.
#[tauri::command]
pub async fn move_path(src: String, dst_dir: String) -> Result<String, String> {
    let src_p = std::path::Path::new(&src);
    if !src_p.exists() {
        return Err(format!("Source does not exist: {}", src));
    }
    let dst_dir_p = std::path::Path::new(&dst_dir);
    if !dst_dir_p.is_dir() {
        return Err(format!("Destination is not a directory: {}", dst_dir));
    }
    let src_name = src_p
        .file_name()
        .ok_or_else(|| "Source has no file name".to_string())?
        .to_string_lossy()
        .to_string();
    let final_name = unique_name(&dst_dir, &src_name);
    let final_path = dst_dir_p.join(&final_name);

    // Fast path: atomic rename (same volume). Windows' MoveFileEx (used by
    // std::fs::rename) also handles cross-volume moves transparently, so this
    // almost always succeeds; the copy+trash fallback below only triggers in
    // edge cases (locked files, special filesystems, permission issues).
    match fs::rename(src_p, &final_path) {
        Ok(()) => Ok(final_path.to_string_lossy().to_string()),
        Err(_) => {
            // Fallback: copy then trash the original. Surface errors from
            // either step so the caller (and user) sees what went wrong.
            if src_p.is_dir() {
                copy_dir_recursive(src_p, &final_path)
                    .map_err(|e| format!("Move (copy step) failed: {}", e))?;
            } else {
                fs::copy(src_p, &final_path)
                    .map_err(|e| format!("Move (copy step) failed: {}", e))?;
            }
            trash::delete(src_p).map_err(|e| format!("Move (delete step) failed: {}", e))?;
            Ok(final_path.to_string_lossy().to_string())
        }
    }
}

/// Pick a non-colliding name inside `dir` based on `name`. If `dir/name` is
/// free, returns `name` unchanged. Otherwise appends " (copy)", " (copy 2)",
/// etc. to the stem (extension preserved for files; no split for directories).
fn unique_name(dir: &str, name: &str) -> String {
    let dir_p = std::path::Path::new(dir);
    // Fast path: no collision.
    if !dir_p.join(name).exists() {
        return name.to_string();
    }
    // Split stem + extension. For directories (no extension) stem=name, ext="".
    // Use Path::file_stem + Path::extension to handle multi-dot names like
    // "archive.tar.gz" → stem="archive.tar", ext="gz" (matches Explorer).
    let name_p = std::path::Path::new(name);
    let stem = name_p
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| name.to_string());
    let ext = name_p
        .extension()
        .map(|s| format!(".{}", s.to_string_lossy()))
        .unwrap_or_default();

    let mut i = 1;
    loop {
        let candidate = if i == 1 {
            format!("{} (copy){}", stem, ext)
        } else {
            format!("{} (copy {}){}", stem, ext, i)
        };
        if !dir_p.join(&candidate).exists() {
            return candidate;
        }
        i += 1;
        // Safety valve — shouldn't happen in practice.
        if i > 9999 {
            return format!("{} (copy {}){}", stem, i, ext);
        }
    }
}

/// Recursively copy a directory tree from `src` to `dst`. Creates `dst` and
/// all intermediate dirs as needed. Preserves neither permissions nor mtimes
/// (best-effort only — content copy is what matters for the explorer use case).
fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        let target = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&path, &target)?;
        } else if file_type.is_symlink() {
            // Copy the link target rather than recreating the symlink — keeps
            // the operation self-contained and avoids dangling links if the
            // target is on a different volume.
            let meta = fs::metadata(&path)?;
            if meta.is_dir() {
                copy_dir_recursive(&path, &target)?;
            } else {
                fs::copy(&path, &target)?;
            }
        } else {
            fs::copy(&path, &target)?;
        }
    }
    Ok(())
}

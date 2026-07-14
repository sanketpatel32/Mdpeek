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
        .add_filter("Text", &["txt"])
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

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    // PDFs are binary — return empty; the frontend never calls this for PDFs
    // (session restore skips the re-read for PDF paths), but guard anyway.
    if path.to_lowercase().ends_with(".pdf") {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

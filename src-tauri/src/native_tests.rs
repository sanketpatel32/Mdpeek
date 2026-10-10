use crate::{commands, read_file_for_frontend};
use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

struct ScratchDir(PathBuf);

impl ScratchDir {
    fn new() -> Self {
        let name = format!(
            "mdpeek-native-tests-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let dir = std::env::temp_dir().join(name);
        fs::create_dir(&dir).unwrap();
        Self(dir.canonicalize().unwrap())
    }

    fn path(&self, name: &str) -> String {
        self.0.join(name).to_string_lossy().into_owned()
    }
}

impl Drop for ScratchDir {
    fn drop(&mut self) {
        // This canonical, uniquely-created fixture directory never contains user files.
        assert!(self
            .0
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("mdpeek-native-tests-"));
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn native_launch_reads_text_and_routes_every_binary_viewer_without_utf8_decoding() {
    let fixture = ScratchDir::new();
    for extension in ["md", "txt", "js", "csv", "ipynb", "excalidraw", "tldr"] {
        let path = fixture.path(&format!("note.{extension}"));
        let content = "# Notes — café 📝\nSecond line".to_string();
        commands::save_file(path.clone(), content.clone()).unwrap();
        assert_eq!(commands::read_file(path.clone()).unwrap(), content);
        let payload = read_file_for_frontend(&path).unwrap();
        assert_eq!(payload.path, path);
        assert_eq!(payload.content, content);
        assert!(!payload.is_dir);
    }
    for extension in [
        "pdf", "PNG", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif", "mp3", "wav",
        "ogg", "flac", "m4a", "aac", "mp4", "webm", "mov", "avi", "m4v", "mkv",
    ] {
        let path = fixture.path(&format!("asset.{extension}"));
        fs::write(&path, [0xff, 0xfe, 0x00, 0x80]).unwrap();
        assert_eq!(commands::read_file(path.clone()).unwrap(), "");
        let payload = read_file_for_frontend(&path).unwrap();
        assert_eq!(payload.path, path);
        assert!(payload.content.is_empty());
        assert!(!payload.is_dir);
    }
    assert!(read_file_for_frontend(&fixture.path("missing.md")).is_err());
    assert!(read_file_for_frontend(&fixture.path("")).unwrap().is_dir);
}

#[test]
fn native_explorer_rejects_recursive_copy_and_move_before_creating_files() {
    let fixture = ScratchDir::new();
    fs::create_dir_all(fixture.0.join("source/child")).unwrap();
    fs::write(fixture.0.join("source/idea.md"), "Keep this work").unwrap();
    tauri::async_runtime::block_on(async {
        for destination in [fixture.path("source"), fixture.path("source/child")] {
            assert!(
                commands::copy_path(fixture.path("source"), destination.clone())
                    .await
                    .is_err()
            );
            assert!(commands::move_path(fixture.path("source"), destination)
                .await
                .is_err());
        }
    });
    assert_eq!(
        fs::read_to_string(fixture.0.join("source/idea.md")).unwrap(),
        "Keep this work"
    );
    assert_eq!(
        fs::read_dir(fixture.0.join("source/child"))
            .unwrap()
            .count(),
        0
    );
}

#[test]
fn native_explorer_create_rename_copy_and_move_preserve_contents_and_avoid_overwriting() {
    let fixture = ScratchDir::new();
    tauri::async_runtime::block_on(async {
        let folder = commands::create_path(fixture.path("notes"), true)
            .await
            .unwrap();
        let file = commands::create_path(fixture.path("notes/idea.md"), false)
            .await
            .unwrap();
        commands::save_file(file.clone(), "Keep this work".into()).unwrap();
        assert!(commands::create_path(file.clone(), false).await.is_err());
        let renamed = commands::rename_path(file.clone(), fixture.path("notes/renamed.md"))
            .await
            .unwrap();
        assert!(!PathBuf::from(file).exists());
        let copied = commands::copy_path(renamed.clone(), folder.clone())
            .await
            .unwrap();
        assert!(copied.ends_with("renamed (copy).md"));
        assert!(commands::rename_path(renamed.clone(), copied.clone())
            .await
            .is_err());
        let destination = commands::create_path(fixture.path("archive"), true)
            .await
            .unwrap();
        let moved = commands::move_path(copied.clone(), destination)
            .await
            .unwrap();
        assert!(!PathBuf::from(copied).exists());
        assert_eq!(commands::read_file(renamed).unwrap(), "Keep this work");
        assert_eq!(commands::read_file(moved).unwrap(), "Keep this work");
        let tree_copy = commands::copy_path(folder, fixture.path("")).await.unwrap();
        assert_eq!(
            fs::read_to_string(PathBuf::from(tree_copy).join("renamed.md")).unwrap(),
            "Keep this work"
        );
    });
    fs::create_dir(fixture.path("node_modules")).unwrap();
    fs::write(fixture.path(".hidden.md"), "hidden").unwrap();
    let entries = commands::list_dir(fixture.path("")).unwrap();
    assert!(entries
        .iter()
        .all(|entry| entry.name != "node_modules" && entry.name != ".hidden.md"));
}

#[test]
fn native_folder_search_and_batch_replace_skip_binary_and_isolate_file_errors() {
    let fixture = ScratchDir::new();
    let note = fixture.path("note.md");
    let binary = fixture.path("asset.png");
    let missing = fixture.path("missing.md");
    commands::save_file(note.clone(), "First IDEA\nSecond idea".into()).unwrap();
    fs::write(&binary, [0, 255, 128]).unwrap();
    fs::create_dir(fixture.path("node_modules")).unwrap();
    fs::write(fixture.path("node_modules/ignored.md"), "idea").unwrap();
    let found =
        commands::search_in_folder(fixture.path(""), "idea".into(), false, Some(100)).unwrap();
    assert_eq!(found.total_matches, 2);
    assert_eq!(found.files_with_matches, 1);
    let sensitive =
        commands::search_in_folder(fixture.path(""), "idea".into(), true, Some(100)).unwrap();
    assert_eq!(sensitive.total_matches, 1);
    let reads = commands::read_files_batch(vec![note.clone(), binary, missing]).unwrap();
    assert!(reads[0].content.as_ref().unwrap().contains("IDEA"));
    assert!(reads[1].content.is_none() && reads[1].error.is_some());
    assert!(reads[2].content.is_none() && reads[2].error.is_some());
    let writes = commands::write_files_batch(vec![
        commands::FileWrite {
            path: note.clone(),
            content: "replaced".into(),
        },
        commands::FileWrite {
            path: fixture.path("nonexistent/failed.md"),
            content: "failure".into(),
        },
    ])
    .unwrap();
    assert!(writes[0].ok);
    assert!(!writes[1].ok && writes[1].error.is_some());
    assert_eq!(commands::read_file(note).unwrap(), "replaced");
}

#[test]
fn native_image_paste_writes_exact_bytes_into_the_requested_assets_folder() {
    let fixture = ScratchDir::new();
    let bytes = vec![0, 1, 254, 255];
    let path =
        commands::save_image(fixture.path("assets"), "pasted.png".into(), bytes.clone()).unwrap();
    assert_eq!(fs::read(path).unwrap(), bytes);
}

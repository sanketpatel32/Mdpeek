use std::path::{Path, PathBuf};

use gpui_kit::component::tree::TreeItem;

const MAX_ENTRIES: usize = 2_000;
const MAX_DEPTH: usize = 8;
const SKIPPED_DIRECTORIES: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    ".vite",
    ".idea",
    ".vscode",
];

pub fn build_file_items(root: &Path) -> Vec<TreeItem> {
    let mut remaining = MAX_ENTRIES;
    build_items_inner(root, root, 0, &mut remaining)
}

fn build_items_inner(
    root: &Path,
    path: &Path,
    depth: usize,
    remaining: &mut usize,
) -> Vec<TreeItem> {
    if depth > MAX_DEPTH || *remaining == 0 {
        return Vec::new();
    }

    let Ok(entries) = std::fs::read_dir(path) else {
        return Vec::new();
    };

    let mut items = entries
        .flatten()
        .filter_map(|entry| {
            if *remaining == 0 {
                return None;
            }

            let path = entry.path();
            let name = path.file_name()?.to_str()?.to_string();
            if name.starts_with('.') && name != ".env" {
                return None;
            }
            if path.is_dir() && SKIPPED_DIRECTORIES.contains(&name.as_str()) {
                return None;
            }

            *remaining = remaining.saturating_sub(1);
            let id = normalize_id(root, &path);
            if path.is_dir() {
                let children = build_items_inner(root, &path, depth + 1, remaining);
                Some(TreeItem::new(id, name).children(children))
            } else {
                Some(TreeItem::new(id, name))
            }
        })
        .collect::<Vec<_>>();

    items.sort_by(|a, b| {
        b.is_folder()
            .cmp(&a.is_folder())
            .then_with(|| a.label.cmp(&b.label))
    });
    items
}

fn normalize_id(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

pub fn resolve_tree_path(root: &Path, id: &str) -> PathBuf {
    root.join(id)
}

pub fn collect_files(root: &Path, limit: usize) -> Vec<PathBuf> {
    let mut files = Vec::new();
    collect_files_inner(root, 0, limit, &mut files);
    files.sort();
    files
}

fn collect_files_inner(path: &Path, depth: usize, limit: usize, files: &mut Vec<PathBuf>) {
    if files.len() >= limit || depth > MAX_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(path) else {
        return;
    };
    for entry in entries.flatten() {
        if files.len() >= limit {
            return;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let path = entry.path();
        if path.is_dir() {
            if !SKIPPED_DIRECTORIES.contains(&name.as_ref()) {
                collect_files_inner(&path, depth + 1, limit, files);
            }
        } else {
            files.push(path);
        }
    }
}

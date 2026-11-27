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
            let id = file_tree_id(root, &path);
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

pub fn file_tree_id(root: &Path, path: &Path) -> String {
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

#[derive(Clone, Debug)]
pub struct SearchMatch {
    pub path: PathBuf,
    pub line: usize,
    pub offset: usize,
    pub text: String,
}

pub fn search_files(root: &Path, query: &str, limit: usize) -> Vec<SearchMatch> {
    let query = query.trim().to_lowercase();
    if query.len() < 2 {
        return Vec::new();
    }
    let mut matches = Vec::new();
    for path in collect_files(root, 1_000) {
        if matches.len() >= limit {
            break;
        }
        let Ok(metadata) = std::fs::metadata(&path) else {
            continue;
        };
        if metadata.len() > 512_000 {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
        };
        let mut offset = 0;
        for (line_ix, line) in content.lines().enumerate() {
            if let Some(column) = line.to_lowercase().find(&query) {
                matches.push(SearchMatch {
                    path: path.clone(),
                    line: line_ix + 1,
                    offset: offset + column,
                    text: line.trim().chars().take(120).collect(),
                });
                if matches.len() >= limit {
                    break;
                }
            }
            offset += line.len() + 1;
        }
    }
    matches
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReplacementResult {
    pub result: String,
    pub count: usize,
}

pub fn apply_replacements(
    content: &str,
    query: &str,
    replacement: &str,
    case_sensitive: bool,
) -> ReplacementResult {
    if query.is_empty() {
        return ReplacementResult {
            result: content.to_string(),
            count: 0,
        };
    }
    let pattern = regex::escape(query);
    let Ok(regex) = regex::RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .build()
    else {
        return ReplacementResult {
            result: content.to_string(),
            count: 0,
        };
    };

    let mut result = String::with_capacity(content.len());
    let mut cursor = 0;
    let mut count = 0;
    for matched in regex.find_iter(content) {
        result.push_str(&content[cursor..matched.start()]);
        result.push_str(replacement);
        cursor = matched.end();
        count += 1;
    }
    if count == 0 {
        return ReplacementResult {
            result: content.to_string(),
            count: 0,
        };
    }
    result.push_str(&content[cursor..]);
    ReplacementResult { result, count }
}

pub fn write_file_atomically(path: &Path, contents: &str) -> std::io::Result<()> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("document");
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let mut temporary = None;
    for counter in 0..100 {
        let candidate = parent.join(format!(
            ".{file_name}.mdpeek-{}-{counter}.tmp",
            std::process::id()
        ));
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(mut file) => {
                use std::io::Write as _;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt as _;
                    let _ = std::fs::set_permissions(
                        &candidate,
                        std::fs::Permissions::from_mode(0o600),
                    );
                }
                let result = file
                    .write_all(contents.as_bytes())
                    .and_then(|()| file.sync_all());
                drop(file);
                if let Err(error) = result {
                    let _ = std::fs::remove_file(&candidate);
                    return Err(error);
                }
                if let Ok(metadata) = std::fs::metadata(path) {
                    let _ = std::fs::set_permissions(&candidate, metadata.permissions());
                }
                temporary = Some(candidate);
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    let Some(temporary) = temporary else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "could not allocate temporary replacement file",
        ));
    };
    match std::fs::rename(&temporary, path) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = std::fs::remove_file(&temporary);
            Err(error)
        }
    }
}

#[cfg(test)]
mod replacement_tests {
    use super::apply_replacements;

    #[test]
    fn replaces_plain_text_verbatim() {
        let result = apply_replacements("alpha $0 alpha", "alpha", "$0 & beta", true);
        assert_eq!(result.result, "$0 & beta $0 $0 & beta");
        assert_eq!(result.count, 2);
    }

    #[test]
    fn case_insensitive_replacement_preserves_unicode_boundaries() {
        let result = apply_replacements("Café CAFÉ cafe", "café", "coffee", false);
        assert_eq!(result.result, "coffee coffee cafe");
        assert_eq!(result.count, 2);
    }

    #[test]
    fn overlapping_matches_are_not_double_counted() {
        let result = apply_replacements("aaaa", "aa", "b", true);
        assert_eq!(result.result, "bb");
        assert_eq!(result.count, 2);
    }
}

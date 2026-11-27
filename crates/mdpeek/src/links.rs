use std::path::{Path, PathBuf};
use std::sync::OnceLock;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BrokenLink {
    pub line: usize,
    pub target: String,
}

pub fn broken_links(source: &str, document_dir: &Path, root: Option<&Path>) -> Vec<BrokenLink> {
    let mut broken = Vec::new();
    let mut in_fence = false;
    for (index, line) in source.lines().enumerate() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        for target in markdown_targets(line).into_iter().chain(wiki_targets(line)) {
            if !link_exists(&target, document_dir, root) {
                broken.push(BrokenLink {
                    line: index + 1,
                    target,
                });
            }
        }
    }
    broken
}

fn markdown_targets(line: &str) -> Vec<String> {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    let regex = RE.get_or_init(|| {
        regex::Regex::new(r"(?:!)?\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)")
            .expect("markdown link regex")
    });
    regex
        .captures_iter(line)
        .map(|captures| {
            captures[1]
                .trim_matches(|ch| ch == '<' || ch == '>')
                .to_string()
        })
        .collect()
}

fn wiki_targets(line: &str) -> Vec<String> {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    let regex = RE.get_or_init(|| {
        regex::Regex::new(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]]").expect("wiki link regex")
    });
    regex
        .captures_iter(line)
        .map(|captures| captures[1].trim().to_string())
        .collect()
}

fn link_exists(target: &str, document_dir: &Path, root: Option<&Path>) -> bool {
    let target = target
        .split('#')
        .next()
        .unwrap_or(target)
        .split('?')
        .next()
        .unwrap_or(target);
    if target.is_empty()
        || target.starts_with("http://")
        || target.starts_with("https://")
        || target.starts_with("mailto:")
        || target.starts_with("data:")
        || target.starts_with("file://")
    {
        return true;
    }
    let target = percent_decode(target);
    let path = PathBuf::from(target);
    let base = if path.is_absolute() {
        path.clone()
    } else {
        document_dir.join(&path)
    };
    if base.exists() {
        return true;
    }
    if base.extension().is_none()
        && ["md", "markdown"]
            .iter()
            .any(|extension| base.with_extension(extension).exists())
    {
        return true;
    }
    if let Some(root) = root
        && !path.is_absolute()
    {
        let rooted = root.join(&path);
        return rooted.exists()
            || (rooted.extension().is_none()
                && ["md", "markdown"]
                    .iter()
                    .any(|extension| rooted.with_extension(extension).exists()));
    }
    false
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%'
            && index + 2 < bytes.len()
            && let Ok(hex) = u8::from_str_radix(&value[index + 1..index + 3], 16)
        {
            decoded.push(hex);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_only_missing_links() {
        let temp = std::env::temp_dir().join(format!("mdpeek-links-{}", std::process::id()));
        std::fs::create_dir_all(&temp).unwrap();
        std::fs::write(temp.join("exists.md"), "# Exists").unwrap();
        let broken = broken_links(
            "[ok](exists.md) [missing](gone.md) [[exists]] [[gone]] [web](https://example.com)",
            &temp,
            Some(&temp),
        );
        assert_eq!(broken.len(), 2);
        assert_eq!(broken[0].target, "gone.md");
        assert_eq!(broken[1].target, "gone");
        let _ = std::fs::remove_dir_all(temp);
    }
}

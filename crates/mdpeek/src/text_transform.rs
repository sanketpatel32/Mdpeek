use crate::editor_ops::EditResult;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TransformOperation {
    SortAscending,
    SortDescending,
    Uppercase,
    Lowercase,
    TitleCase,
    ToggleCase,
    InsertToc,
    InsertDate,
}

fn replace(text: &str, start: usize, end: usize, replacement: String) -> EditResult {
    let mut output = String::with_capacity(text.len() + replacement.len());
    output.push_str(&text[..start]);
    output.push_str(&replacement);
    output.push_str(&text[end..]);
    EditResult {
        text: output,
        start,
        end: start + replacement.len(),
    }
}

fn line_range(text: &str, start: usize, end: usize) -> (usize, usize) {
    let start = start.min(end).min(text.len());
    let end = end.max(start).min(text.len());
    let line_start = text[..start].rfind('\n').map_or(0, |index| index + 1);
    let effective_end = if end > start && end > 0 && text.as_bytes()[end - 1] == b'\n' {
        end - 1
    } else {
        end
    };
    let line_end = text[effective_end..]
        .find('\n')
        .map_or(text.len(), |index| effective_end + index);
    (line_start, line_end)
}

fn sort_lines(text: &str, start: usize, end: usize, ascending: bool) -> EditResult {
    let (line_start, line_end) = line_range(text, start, end);
    let mut lines = text[line_start..line_end].split('\n').collect::<Vec<_>>();
    lines.sort_by(|a, b| {
        let ordering = a.to_lowercase().cmp(&b.to_lowercase());
        if ascending {
            ordering
        } else {
            ordering.reverse()
        }
    });
    replace(text, line_start, line_end, lines.join("\n"))
}

fn title_case(source: &str) -> String {
    let mut uppercase = true;
    source
        .chars()
        .flat_map(|ch| {
            if ch.is_whitespace() || matches!(ch, '-' | '_' | '(' | '[' | '"' | '\'') {
                uppercase = true;
                vec![ch]
            } else if uppercase {
                uppercase = false;
                ch.to_uppercase().collect()
            } else {
                ch.to_lowercase().collect()
            }
        })
        .collect()
}

fn toggle_case(source: &str) -> String {
    source
        .chars()
        .flat_map(|ch| {
            if ch.is_uppercase() {
                ch.to_lowercase().collect::<Vec<_>>()
            } else if ch.is_lowercase() {
                ch.to_uppercase().collect()
            } else {
                vec![ch]
            }
        })
        .collect()
}

fn heading_slug(text: &str) -> String {
    text.chars()
        .filter_map(|ch| {
            if ch.is_alphanumeric() {
                Some(ch.to_ascii_lowercase())
            } else if ch.is_whitespace() || ch == '-' {
                Some('-')
            } else {
                None
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

pub fn table_of_contents(source: &str) -> String {
    let mut in_fence = false;
    let mut entries = Vec::new();
    for line in source.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence || !trimmed.starts_with('#') {
            continue;
        }
        let hashes = trimmed.chars().take_while(|ch| *ch == '#').count();
        if hashes == 0 || hashes > 6 || !trimmed[hashes..].starts_with(' ') {
            continue;
        }
        let title = trimmed[hashes..].trim();
        if title.is_empty() {
            continue;
        }
        entries.push(format!(
            "{}- [{}](#{})",
            "  ".repeat(hashes.saturating_sub(1)),
            title,
            heading_slug(title)
        ));
    }
    if entries.is_empty() {
        String::new()
    } else {
        format!("{}\n", entries.join("\n"))
    }
}

pub fn apply_transform(
    text: &str,
    start: usize,
    end: usize,
    operation: TransformOperation,
) -> EditResult {
    let start = start.min(end).min(text.len());
    let end = end.max(start).min(text.len());
    match operation {
        TransformOperation::SortAscending => sort_lines(text, start, end, true),
        TransformOperation::SortDescending => sort_lines(text, start, end, false),
        TransformOperation::Uppercase => replace(text, start, end, text[start..end].to_uppercase()),
        TransformOperation::Lowercase => replace(text, start, end, text[start..end].to_lowercase()),
        TransformOperation::TitleCase => replace(text, start, end, title_case(&text[start..end])),
        TransformOperation::ToggleCase => replace(text, start, end, toggle_case(&text[start..end])),
        TransformOperation::InsertToc => {
            let toc = table_of_contents(text);
            replace(text, start, end, format!("{toc}\n"))
        }
        TransformOperation::InsertDate => replace(
            text,
            start,
            end,
            chrono::Local::now().format("%Y-%m-%d").to_string(),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::{TransformOperation, apply_transform, table_of_contents};

    #[test]
    fn sorts_selected_lines_case_insensitively() {
        let result = apply_transform("z\nBeta\nalpha", 0, 12, TransformOperation::SortAscending);
        assert_eq!(result.text, "alpha\nBeta\nz");
    }

    #[test]
    fn converts_cases() {
        assert_eq!(
            apply_transform("hello world", 0, 11, TransformOperation::Uppercase).text,
            "HELLO WORLD"
        );
        assert_eq!(
            apply_transform("hello world", 0, 11, TransformOperation::TitleCase).text,
            "Hello World"
        );
        assert_eq!(
            apply_transform("HeLLo", 0, 5, TransformOperation::ToggleCase).text,
            "hEllO"
        );
    }

    #[test]
    fn builds_toc_outside_code_fences() {
        let source = "# Title\n\n```\n# fake\n```\n\n## Details\n";
        assert_eq!(
            table_of_contents(source),
            "- [Title](#title)\n  - [Details](#details)\n"
        );
    }
}

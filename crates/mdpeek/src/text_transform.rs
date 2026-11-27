use std::collections::HashMap;

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

pub fn heading_slug(text: &str) -> String {
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MarkdownHeading {
    pub level: usize,
    pub title: String,
    pub slug: String,
    pub start: usize,
    pub end: usize,
}

pub fn markdown_headings(source: &str) -> Vec<MarkdownHeading> {
    let lines = source
        .split_inclusive('\n')
        .scan(0, |line_start, line| {
            let start = *line_start;
            *line_start += line.len();
            let content = line.trim_end_matches(['\n', '\r']);
            Some((content, start, start + content.len()))
        })
        .collect::<Vec<_>>();
    let mut in_fence = false;
    let mut headings = Vec::new();
    for (index, (content, start, end)) in lines.iter().enumerate() {
        let trimmed = content.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        if trimmed.starts_with('#') {
            let hashes = trimmed.chars().take_while(|ch| *ch == '#').count();
            if (1..=6).contains(&hashes) && trimmed[hashes..].starts_with(' ') {
                let title = trimmed[hashes..].trim();
                if !title.is_empty() {
                    headings.push(MarkdownHeading {
                        level: hashes,
                        title: title.to_string(),
                        slug: heading_slug(title),
                        start: *start,
                        end: *end,
                    });
                }
            }
            continue;
        }
        let Some((underline, _, _)) = lines.get(index + 1) else {
            continue;
        };
        let underline = underline.trim();
        let level = if !underline.is_empty() && underline.chars().all(|ch| ch == '=') {
            Some(1)
        } else if !underline.is_empty() && underline.chars().all(|ch| ch == '-') {
            Some(2)
        } else {
            None
        };
        let Some(level) = level else { continue };
        let title = trimmed;
        if title.is_empty()
            || title.starts_with('>')
            || title.starts_with("- ")
            || title.starts_with("* ")
            || title.starts_with("+ ")
            || title
                .split_once(". ")
                .is_some_and(|(number, _)| number.chars().all(|ch| ch.is_ascii_digit()))
        {
            continue;
        }
        headings.push(MarkdownHeading {
            level,
            title: title.to_string(),
            slug: heading_slug(title),
            start: *start,
            end: *end,
        });
    }
    headings.sort_by_key(|heading| heading.start);
    let mut occurrences = HashMap::<String, usize>::new();
    for heading in &mut headings {
        let base = heading.slug.clone();
        let occurrence = occurrences.entry(base.clone()).or_insert(0);
        if *occurrence > 0 {
            heading.slug = format!("{base}-{occurrence}");
        }
        *occurrence += 1;
    }
    headings
}

pub fn table_of_contents(source: &str) -> String {
    let entries = markdown_headings(source)
        .iter()
        .map(|heading| {
            format!(
                "{}- [{}](#{})",
                "  ".repeat(heading.level.saturating_sub(1)),
                heading.title,
                heading.slug
            )
        })
        .collect::<Vec<_>>();
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
            let mut insertion = String::new();
            if start > 0 && text.as_bytes().get(start - 1) != Some(&b'\n') {
                insertion.push_str("\n\n");
            }
            insertion.push_str(&toc);
            insertion.push('\n');
            replace(text, start, end, insertion)
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
    use super::{TransformOperation, apply_transform, markdown_headings, table_of_contents};

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

    #[test]
    fn includes_setext_headings_and_uniquifies_repeated_slugs() {
        let source = "Title\n=====\n\n# Title\n\n## Title\n";
        let headings = markdown_headings(source);
        assert_eq!(
            headings
                .iter()
                .map(|heading| heading.slug.as_str())
                .collect::<Vec<_>>(),
            vec!["title", "title-1", "title-2"]
        );
        assert_eq!(headings[0].level, 1);
    }

    #[test]
    fn starts_toc_on_a_new_block() {
        let source = "# Title\nintro";
        let result = apply_transform(
            source,
            source.len(),
            source.len(),
            TransformOperation::InsertToc,
        );
        assert_eq!(result.text, "# Title\nintro\n\n- [Title](#title)\n\n");
    }
}

use std::collections::{HashMap, HashSet};

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
    let parse_options = markdown::ParseOptions::gfm();
    let Ok(markdown::mdast::Node::Root(root)) = markdown::to_mdast(source, &parse_options) else {
        return Vec::new();
    };
    let mut headings = Vec::new();
    collect_headings(&markdown::mdast::Node::Root(root), &mut headings);
    headings.sort_by_key(|heading| heading.start);
    let mut occurrences = HashMap::<String, usize>::new();
    let mut used = HashSet::<String>::new();
    for heading in &mut headings {
        let base = heading.slug.clone();
        let occurrence = occurrences.entry(base.clone()).or_insert(0);
        loop {
            let candidate = if *occurrence == 0 {
                base.clone()
            } else {
                format!("{base}-{occurrence}")
            };
            if used.insert(candidate.clone()) {
                heading.slug = candidate;
                break;
            }
            *occurrence += 1;
        }
        *occurrence += 1;
    }
    headings
}

fn collect_headings(node: &markdown::mdast::Node, headings: &mut Vec<MarkdownHeading>) {
    if matches!(node, markdown::mdast::Node::FootnoteDefinition(_)) {
        return;
    }
    if let markdown::mdast::Node::Heading(heading) = node {
        let title = heading
            .children
            .iter()
            .map(plain_text)
            .collect::<String>()
            .trim()
            .to_string();
        if !title.is_empty()
            && let Some(position) = &heading.position
        {
            headings.push(MarkdownHeading {
                level: usize::from(heading.depth),
                slug: heading_slug(&title),
                title,
                start: position.start.offset,
                end: position.end.offset,
            });
        }
    }
    if let Some(children) = node.children() {
        for child in children {
            collect_headings(child, headings);
        }
    }
}

fn plain_text(node: &markdown::mdast::Node) -> String {
    match node {
        markdown::mdast::Node::Text(text) => text.value.clone(),
        markdown::mdast::Node::InlineCode(code) => code.value.clone(),
        markdown::mdast::Node::InlineMath(math) => math.value.clone(),
        markdown::mdast::Node::Image(image) => image.alt.clone(),
        markdown::mdast::Node::ImageReference(image) => image.alt.clone(),
        _ => node
            .children()
            .map(|children| children.iter().map(plain_text).collect())
            .unwrap_or_default(),
    }
}

fn escape_toc_label(title: &str) -> String {
    title
        .replace('\\', "\\\\")
        .replace('[', "\\[")
        .replace(']', "\\]")
}

pub fn table_of_contents(source: &str) -> String {
    let entries = markdown_headings(source)
        .iter()
        .map(|heading| {
            format!(
                "{}- [{}](#{})",
                "  ".repeat(heading.level.saturating_sub(1)),
                escape_toc_label(&heading.title),
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
    fn image_only_headings_use_alt_text_and_escape_brackets() {
        let source = "# ![Diagram alt](image.png)\n\n# Literal \\] bracket\n";
        let headings = markdown_headings(source);
        assert_eq!(headings[0].slug, "diagram-alt");
        let toc = table_of_contents(source);
        assert!(toc.contains("[Literal \\] bracket](#literal-bracket)"));
    }

    #[test]
    fn footnote_definition_headings_are_excluded() {
        let source = "# Body\n\n[^note]: # Footnote heading\n";
        let headings = markdown_headings(source);
        assert_eq!(headings.len(), 1);
        assert_eq!(headings[0].title, "Body");
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
    fn ordered_list_before_rule_is_not_a_setext_heading() {
        let source = "1) item\n---\n\n## Real\n";
        let headings = markdown_headings(source);
        assert_eq!(headings.len(), 1);
        assert_eq!(headings[0].title, "Real");
    }

    #[test]
    fn slug_suffixes_do_not_collide_with_literal_heading_slugs() {
        let source = "# A-1\n\n# A\n\n# A\n";
        let headings = markdown_headings(source);
        assert_eq!(
            headings
                .iter()
                .map(|heading| heading.slug.as_str())
                .collect::<Vec<_>>(),
            vec!["a-1", "a", "a-2"]
        );
    }

    #[test]
    fn indented_code_is_not_a_setext_heading() {
        let source = "    1234567890. label\n    ---\n\n## Real\n";
        let headings = markdown_headings(source);
        assert_eq!(headings.len(), 1);
        assert_eq!(headings[0].title, "Real");
    }

    #[test]
    fn non_list_ordered_text_can_be_a_setext_heading() {
        for title in [") item", "1234567890) item"] {
            let source = format!("{title}\n---\n");
            let headings = markdown_headings(&source);
            assert_eq!(headings.len(), 1);
            assert_eq!(headings[0].title, title);
        }
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

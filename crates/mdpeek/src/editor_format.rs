use crate::editor_ops::EditResult;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FormatOperation {
    Bold,
    Italic,
    Strikethrough,
    InlineCode,
    Link,
    BulletList,
    OrderedList,
    TaskList,
    Quote,
    CodeBlock,
    Table,
    HorizontalRule,
}

fn selected_or_placeholder<'a>(
    text: &'a str,
    start: usize,
    end: usize,
    placeholder: &'a str,
) -> String {
    let selected = text.get(start..end).unwrap_or_default();
    if selected.is_empty() {
        placeholder.to_string()
    } else {
        selected.to_string()
    }
}

fn replace_range(
    text: &str,
    start: usize,
    end: usize,
    replacement: String,
    selection_offset: usize,
    selection_len: usize,
) -> EditResult {
    let mut output = String::with_capacity(text.len() + replacement.len());
    output.push_str(&text[..start]);
    output.push_str(&replacement);
    output.push_str(&text[end..]);
    EditResult {
        text: output,
        start: start + selection_offset,
        end: start + selection_offset + selection_len,
    }
}

fn toggle_inline(
    text: &str,
    start: usize,
    end: usize,
    marker: &str,
    placeholder: &str,
) -> EditResult {
    let marker_len = marker.len();
    if start >= marker_len
        && end + marker_len <= text.len()
        && text.get(start - marker_len..start) == Some(marker)
        && text.get(end..end + marker_len) == Some(marker)
    {
        let mut output = String::with_capacity(text.len() - marker_len * 2);
        output.push_str(&text[..start - marker_len]);
        output.push_str(&text[start..end]);
        output.push_str(&text[end + marker_len..]);
        return EditResult {
            text: output,
            start: start - marker_len,
            end: end - marker_len,
        };
    }
    let inner = selected_or_placeholder(text, start, end, placeholder);
    let inner_len = inner.len();
    replace_range(
        text,
        start,
        end,
        format!("{marker}{inner}{marker}"),
        marker_len,
        inner_len,
    )
}

fn line_boundaries(text: &str, start: usize, end: usize) -> (usize, usize) {
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

fn prefix_lines(text: &str, start: usize, end: usize, operation: FormatOperation) -> EditResult {
    let (line_start, line_end) = line_boundaries(text, start, end);
    let block = &text[line_start..line_end];
    let lines = block.split('\n').collect::<Vec<_>>();
    let prefix_for = |index: usize| match operation {
        FormatOperation::BulletList => "- ".to_string(),
        FormatOperation::OrderedList => format!("{}. ", index + 1),
        FormatOperation::TaskList => "- [ ] ".to_string(),
        FormatOperation::Quote => "> ".to_string(),
        _ => unreachable!(),
    };
    fn strip_prefix(line: &str, operation: FormatOperation) -> Option<&str> {
        let trimmed = line.trim_start();
        match operation {
            FormatOperation::BulletList => trimmed
                .strip_prefix("- ")
                .or_else(|| trimmed.strip_prefix("* ")),
            FormatOperation::OrderedList => trimmed
                .split_once(". ")
                .filter(|(number, _)| number.chars().all(|ch| ch.is_ascii_digit()))
                .map(|(_, rest)| rest),
            FormatOperation::TaskList => trimmed
                .strip_prefix("- [ ] ")
                .or_else(|| trimmed.strip_prefix("- [x] "))
                .or_else(|| trimmed.strip_prefix("- [X] ")),
            FormatOperation::Quote => trimmed.strip_prefix("> "),
            _ => None,
        }
    }
    let already_prefixed = lines
        .iter()
        .all(|line| strip_prefix(line, operation).is_some());
    let replacement = lines
        .iter()
        .enumerate()
        .map(|(index, line)| {
            if already_prefixed {
                strip_prefix(line, operation).unwrap_or(line).to_string()
            } else {
                format!("{}{line}", prefix_for(index))
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    replace_range(
        text,
        line_start,
        line_end,
        replacement.clone(),
        replacement.len(),
        0,
    )
}

fn block_insert(text: &str, start: usize, end: usize, block: &str) -> EditResult {
    let cursor = start + block.len();
    replace_range(text, start, end, block.to_string(), block.len(), 0).with_cursor(cursor)
}

trait CursorEdit {
    fn with_cursor(self, cursor: usize) -> Self;
}
impl CursorEdit for EditResult {
    fn with_cursor(mut self, cursor: usize) -> Self {
        self.start = cursor;
        self.end = cursor;
        self
    }
}

pub fn apply_format(
    text: &str,
    start: usize,
    end: usize,
    operation: FormatOperation,
) -> EditResult {
    let start = start.min(end).min(text.len());
    let end = end.max(start).min(text.len());
    match operation {
        FormatOperation::Bold => toggle_inline(text, start, end, "**", "bold text"),
        FormatOperation::Italic => toggle_inline(text, start, end, "*", "italic text"),
        FormatOperation::Strikethrough => toggle_inline(text, start, end, "~~", "struck text"),
        FormatOperation::InlineCode => toggle_inline(text, start, end, "`", "code"),
        FormatOperation::Link => {
            let label = selected_or_placeholder(text, start, end, "link text");
            let label_len = label.len();
            replace_range(
                text,
                start,
                end,
                format!("[{label}](https://example.com)"),
                1,
                label_len,
            )
        }
        FormatOperation::BulletList
        | FormatOperation::OrderedList
        | FormatOperation::TaskList
        | FormatOperation::Quote => prefix_lines(text, start, end, operation),
        FormatOperation::CodeBlock => {
            let inner = selected_or_placeholder(text, start, end, "code");
            let inner_len = inner.len();
            replace_range(
                text,
                start,
                end,
                format!("```\n{inner}\n```\n"),
                4,
                inner_len,
            )
        }
        FormatOperation::Table => block_insert(
            text,
            start,
            end,
            "| Header 1 | Header 2 | Header 3 |\n| --- | --- | --- |\n| Cell 1 | Cell 2 | Cell 3 |\n| Cell 4 | Cell 5 | Cell 6 |\n",
        ),
        FormatOperation::HorizontalRule => block_insert(text, start, end, "\n---\n"),
    }
}

#[cfg(test)]
mod tests {
    use super::{FormatOperation, apply_format};

    #[test]
    fn bold_wraps_and_unwraps_selection() {
        let wrapped = apply_format("hello world", 6, 11, FormatOperation::Bold);
        assert_eq!(wrapped.text, "hello **world**");
        assert_eq!(&wrapped.text[wrapped.start..wrapped.end], "world");
        let unwrapped = apply_format(
            &wrapped.text,
            wrapped.start,
            wrapped.end,
            FormatOperation::Bold,
        );
        assert_eq!(unwrapped.text, "hello world");
    }

    #[test]
    fn task_prefixes_and_unprefixes_lines() {
        let result = apply_format("one\ntwo", 0, 7, FormatOperation::TaskList);
        assert_eq!(result.text, "- [ ] one\n- [ ] two");
        let result = apply_format(
            &result.text,
            0,
            result.text.len(),
            FormatOperation::TaskList,
        );
        assert_eq!(result.text, "one\ntwo");
    }

    #[test]
    fn inline_formatting_handles_unicode_boundaries() {
        let source = "éa";
        let result = apply_format(source, 2, 3, FormatOperation::Bold);
        assert_eq!(result.text, "é**a**");
    }

    #[test]
    fn ordered_list_numbers_lines() {
        assert_eq!(
            apply_format("a\nb", 0, 3, FormatOperation::OrderedList).text,
            "1. a\n2. b"
        );
    }

    #[test]
    fn code_fence_selects_placeholder() {
        let result = apply_format("", 0, 0, FormatOperation::CodeBlock);
        assert_eq!(result.text, "```\ncode\n```\n");
        assert_eq!(&result.text[result.start..result.end], "code");
    }
}

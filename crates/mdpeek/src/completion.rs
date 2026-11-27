use std::rc::Rc;

use gpui_kit::component::input::{CompletionProvider, Rope, RopeExt};
use gpui_kit::{App, Task, Window};
use lsp_types::{
    CompletionContext, CompletionItem, CompletionItemKind, CompletionResponse, CompletionTextEdit,
    CompletionTriggerKind, Position, Range, TextEdit,
};

pub struct MarkdownCompletions;

const SNIPPETS: &[(&str, &str, &str)] = &[
    ("Heading 1", "# Heading", "# "),
    ("Heading 2", "## Heading", "## "),
    ("Heading 3", "### Heading", "### "),
    ("Bold", "**bold text**", "**"),
    ("Italic", "*italic text*", "*"),
    ("Strikethrough", "~~strikethrough~~", "~~"),
    ("Inline code", "`code`", "`"),
    ("Code block", "```\ncode\n```\n", "```"),
    ("Quote", "> Quote", "> "),
    ("Bulleted list", "- Item", "- "),
    ("Numbered list", "1. Item", "1."),
    ("Task", "- [ ] Task", "- ["),
    ("Link", "[link text](https://example.com)", "["),
    ("Image", "![alt text](image.png)", "!"),
    (
        "Table",
        "| Column | Value |\n| --- | --- |\n| Item | Text |\n",
        "|",
    ),
    ("Note callout", "> [!NOTE]\nUseful information.\n", "!note"),
    (
        "Warning callout",
        "> [!WARNING]\nImportant caution.\n",
        "!warning",
    ),
    ("Inline math", "$E = mc^2$", "$"),
    ("Block math", "$$\nE = mc^2\n$$\n", "$$"),
    (
        "Mermaid diagram",
        "```mermaid\nflowchart TD\n  A[Start] --> B[Done]\n```\n",
        "mermaid",
    ),
];

impl MarkdownCompletions {
    pub fn provider() -> Rc<dyn CompletionProvider> {
        Rc::new(Self)
    }

    fn offset_position(text: &Rope, offset: usize) -> Option<Position> {
        (offset <= text.len()).then(|| text.offset_to_position(offset))
    }

    fn completion_item(label: &str, insert: &str, detail: &str, range: Range) -> CompletionItem {
        CompletionItem {
            label: label.to_string(),
            kind: Some(CompletionItemKind::SNIPPET),
            detail: Some(detail.to_string()),
            filter_text: Some(format!("{label} {detail}")),
            text_edit: Some(CompletionTextEdit::Edit(TextEdit {
                range,
                new_text: insert.to_string(),
            })),
            ..Default::default()
        }
    }
}

impl CompletionProvider for MarkdownCompletions {
    fn completions(
        &self,
        text: &Rope,
        offset: usize,
        trigger: CompletionContext,
        _window: &mut Window,
        _cx: &mut App,
    ) -> Task<anyhow::Result<CompletionResponse>> {
        let query = if trigger.trigger_kind == CompletionTriggerKind::TRIGGER_CHARACTER {
            trigger.trigger_character.unwrap_or_default()
        } else {
            let mut start = offset;
            while start > 0 {
                let char_index = text.byte_to_char_idx(start);
                if char_index == 0 {
                    break;
                }
                let ch = text.char(char_index - 1);
                if !(ch.is_alphanumeric()
                    || matches!(
                        ch,
                        '#' | '-' | '!' | '[' | '*' | '_' | '`' | '|' | '$' | '>' | '~'
                    ))
                {
                    break;
                }
                start -= ch.len_utf8();
            }
            text.slice(text.byte_to_char_idx(start)..text.byte_to_char_idx(offset))
                .to_string()
        };
        let normalized = query.trim().to_lowercase();
        let start = offset.saturating_sub(query.len());
        let (Some(start_position), Some(end_position)) = (
            Self::offset_position(text, start),
            Self::offset_position(text, offset),
        ) else {
            return Task::ready(Ok(CompletionResponse::Array(vec![])));
        };
        let range = Range::new(start_position, end_position);
        let items = SNIPPETS
            .iter()
            .filter(|(label, insert, detail)| {
                normalized.is_empty()
                    || label.to_lowercase().contains(&normalized)
                    || insert.to_lowercase().contains(&normalized)
                    || detail.to_lowercase().contains(&normalized)
            })
            .map(|(label, insert, detail)| Self::completion_item(label, insert, detail, range))
            .collect();
        Task::ready(Ok(CompletionResponse::Array(items)))
    }

    fn is_completion_trigger(&self, _offset: usize, new_text: &str, _cx: &mut App) -> bool {
        new_text.chars().all(|ch| {
            ch.is_alphanumeric()
                || matches!(
                    ch,
                    '#' | '-' | '!' | '[' | '*' | '_' | '`' | '|' | '$' | '>' | '~'
                )
        })
    }
}

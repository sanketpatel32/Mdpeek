use std::{
    path::{Path, PathBuf},
    sync::OnceLock,
    time::SystemTime,
};

use gpui_kit::component::{
    ActiveTheme as _, Sizable as _,
    button::{Button, ButtonVariants as _},
    clipboard::Clipboard,
    h_flex,
    input::{Editor, EditorState, InputEvent, Position, TabSize},
    resizable::{h_resizable, resizable_panel},
    status_bar::StatusBar,
    text::{MarkdownExtensions, TextView, TextViewState},
    v_flex,
};
use gpui_kit::{prelude::FluentBuilder as _, *};

use crate::{
    app::Mdpeek,
    math::{InlineMathPlugin, MathPlugin},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DocumentKind {
    Markdown,
    PlainText,
    Code,
    Csv,
    Image,
    Unknown,
}

impl DocumentKind {
    pub fn from_path(path: &Path) -> Self {
        let extension = path
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();

        match extension.as_str() {
            "md" | "markdown" | "mdx" => Self::Markdown,
            "txt" | "log" => Self::PlainText,
            "csv" | "tsv" => Self::Csv,
            "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico" | "avif" => Self::Image,
            "js" | "mjs" | "cjs" | "ts" | "tsx" | "jsx" | "json" | "css" | "scss" | "less"
            | "html" | "htm" | "xml" | "vue" | "svelte" | "yml" | "yaml" | "toml" | "ini"
            | "cfg" | "conf" | "env" | "sh" | "bash" | "py" | "rb" | "go" | "rs" | "java" | "c"
            | "h" | "cpp" | "cs" | "php" | "swift" | "kt" | "scala" | "sql" | "graphql"
            | "proto" | "lua" | "r" | "dart" | "diff" | "patch" => Self::Code,
            _ => Self::Unknown,
        }
    }

    pub fn is_text_editable(self) -> bool {
        !matches!(self, Self::Image)
    }

    fn language(self, path: Option<&Path>) -> String {
        if self == Self::Markdown {
            return "markdown".to_string();
        }
        if self == Self::PlainText || self == Self::Csv {
            return "text".to_string();
        }

        match path
            .and_then(|path| path.extension())
            .and_then(|extension| extension.to_str())
            .unwrap_or_default()
        {
            "mjs" | "cjs" | "jsx" => "javascript",
            "tsx" => "tsx",
            "ts" => "typescript",
            "yml" => "yaml",
            "htm" => "html",
            "sh" => "bash",
            "rb" => "ruby",
            "cs" => "csharp",
            "cpp" | "h" | "c" => "cpp",
            extension => extension,
        }
        .to_string()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ViewMode {
    Preview,
    Edit,
    Split,
}

impl ViewMode {
    pub fn next_for_edit_toggle(self) -> Self {
        match self {
            Self::Preview => Self::Edit,
            Self::Edit | Self::Split => Self::Preview,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Preview => "Preview",
            Self::Edit => "Edit",
            Self::Split => "Split",
        }
    }
}

pub struct DocumentView {
    pub path: Option<PathBuf>,
    pub kind: DocumentKind,
    editor: Entity<EditorState>,
    preview: Entity<TextViewState>,
    mode: ViewMode,
    saved_value: String,
    dirty: bool,
    modified_at: Option<SystemTime>,
    preview_zoom: f32,
    owner: Option<WeakEntity<Mdpeek>>,
    _subscriptions: Vec<Subscription>,
}

impl DocumentView {
    pub fn new(
        path: Option<PathBuf>,
        content: impl Into<String>,
        kind: DocumentKind,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let content = content.into();
        let language = kind.language(path.as_deref());
        let editor = cx.new(|cx| {
            EditorState::new(window, cx)
                .language(language)
                .line_number(true)
                .indent_guides(true)
                .folding(true)
                .tab_size(TabSize {
                    tab_size: 2,
                    ..Default::default()
                })
                .searchable(true)
                .placeholder("Write Markdown…")
                .default_value(content.clone())
        });
        let preview_source = renderable_source(kind, &content);
        let preview = cx.new(|cx| TextViewState::markdown(preview_source.as_str(), cx));
        let focus_handle = editor.focus_handle(cx);
        window.defer(cx, move |window, cx| {
            focus_handle.focus(window, cx);
        });

        let _subscriptions = vec![cx.subscribe(&editor, |this, _, event: &InputEvent, cx| {
            if matches!(event, InputEvent::Change) {
                let value = this.editor.read(cx).value().to_string();
                this.dirty = value != this.saved_value;
                let preview_source = renderable_source(this.kind, &value);
                this.preview
                    .update(cx, |preview, cx| preview.set_text(&preview_source, cx));
                cx.notify();
            }
        })];

        Self {
            path: path.clone(),
            kind,
            editor,
            preview,
            mode: match kind {
                DocumentKind::Markdown => ViewMode::Split,
                DocumentKind::Csv | DocumentKind::Image => ViewMode::Preview,
                _ => ViewMode::Edit,
            },
            saved_value: content,
            dirty: false,
            modified_at: path
                .as_ref()
                .and_then(|path| std::fs::metadata(path).ok())
                .and_then(|metadata| metadata.modified().ok()),
            preview_zoom: 1.0,
            owner: None,
            _subscriptions,
        }
    }

    pub fn untitled(window: &mut Window, cx: &mut Context<Self>) -> Self {
        Self::new(None, String::new(), DocumentKind::Markdown, window, cx)
    }

    pub fn title(&self) -> SharedString {
        self.path
            .as_ref()
            .and_then(|path| path.file_name())
            .and_then(|name| name.to_str())
            .unwrap_or("Untitled")
            .to_string()
            .into()
    }

    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    pub fn value(&self, cx: &App) -> String {
        self.editor.read(cx).value().to_string()
    }

    pub fn toggle_edit(&mut self, cx: &mut Context<Self>) {
        if !self.kind.is_text_editable() {
            return;
        }
        self.mode = self.mode.next_for_edit_toggle();
        cx.notify();
    }

    pub fn externally_changed(&self) -> bool {
        let Some(path) = &self.path else {
            return false;
        };
        let Ok(modified) = std::fs::metadata(path).and_then(|metadata| metadata.modified()) else {
            return false;
        };
        self.modified_at.is_none_or(|known| modified != known)
    }

    pub fn reveal_offset(&mut self, offset: usize, window: &mut Window, cx: &mut Context<Self>) {
        self.editor.update(cx, |editor, cx| {
            let value = editor.value();
            let offset = offset.min(value.len());
            let mut line = 0u32;
            let mut character = 0u32;
            for ch in value[..offset].chars() {
                if ch == '\n' {
                    line += 1;
                    character = 0;
                } else {
                    character += ch.len_utf16() as u32;
                }
            }
            editor.set_cursor_position(Position { line, character }, window, cx);
        });
    }

    pub fn toggle_task(
        &mut self,
        checked: bool,
        marker_range: std::ops::Range<usize>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let mut value = self.editor.read(cx).value().to_string();
        if marker_range.end > value.len()
            || !value.is_char_boundary(marker_range.start)
            || !value.is_char_boundary(marker_range.end)
        {
            return;
        }
        value.replace_range(marker_range, if checked { "[x]" } else { "[ ]" });
        self.editor.update(cx, |editor, cx| {
            editor.set_value(value.clone(), window, cx);
        });
        self.dirty = value != self.saved_value;
        let preview_source = renderable_source(self.kind, &value);
        self.preview.update(cx, |preview, cx| {
            preview.set_text(&preview_source, cx);
        });
        cx.notify();
    }

    pub fn set_owner(&mut self, owner: WeakEntity<Mdpeek>) {
        self.owner = Some(owner);
    }

    pub fn show_preview(&mut self, cx: &mut Context<Self>) {
        if self.kind != DocumentKind::Image {
            self.mode = ViewMode::Preview;
            cx.notify();
        }
    }

    pub fn cycle_mode(&mut self, cx: &mut Context<Self>) {
        if !self.kind.is_text_editable() {
            return;
        }
        self.mode = match self.mode {
            ViewMode::Preview => ViewMode::Edit,
            ViewMode::Edit => ViewMode::Split,
            ViewMode::Split => ViewMode::Preview,
        };
        cx.notify();
    }

    pub fn mark_saved(&mut self, path: PathBuf, cx: &mut Context<Self>) {
        self.saved_value = self.editor.read(cx).value().to_string();
        self.dirty = false;
        self.kind = DocumentKind::from_path(&path);
        self.modified_at = std::fs::metadata(&path)
            .ok()
            .and_then(|metadata| metadata.modified().ok());
        self.path = Some(path);
        cx.notify();
    }

    pub fn reload_from_disk(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Result<()> {
        let Some(path) = self.path.clone() else {
            return Ok(());
        };
        let content = std::fs::read_to_string(&path)?;
        self.editor.update(cx, |editor, cx| {
            editor.set_value(content.clone(), window, cx);
        });
        let preview_source = renderable_source(self.kind, &content);
        self.preview
            .update(cx, |preview, cx| preview.set_text(&preview_source, cx));
        self.modified_at = std::fs::metadata(&path)
            .ok()
            .and_then(|metadata| metadata.modified().ok());
        self.saved_value = content;
        self.dirty = false;
        cx.notify();
        Ok(())
    }

    fn render_toolbar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        h_flex()
            .w_full()
            .h_8()
            .px_2()
            .gap_1()
            .items_center()
            .justify_end()
            .border_b_1()
            .border_color(cx.theme().border)
            .bg(cx.theme().title_bar)
            .child(
                Button::new("mode")
                    .ghost()
                    .xsmall()
                    .label(self.mode.label())
                    .tooltip("Cycle preview/edit/split")
                    .on_click(cx.listener(|this, _, _, cx| this.cycle_mode(cx))),
            )
            .child(
                Button::new("zoom")
                    .ghost()
                    .xsmall()
                    .label(format!("{:.0}%", self.preview_zoom * 100.0))
                    .tooltip("Cycle preview zoom")
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.preview_zoom = if this.preview_zoom >= 2.0 {
                            0.75
                        } else {
                            this.preview_zoom + 0.25
                        };
                        cx.notify();
                    })),
            )
    }

    fn render_editor(&self) -> impl IntoElement {
        div()
            .size_full()
            .child(Editor::new(&self.editor).h(relative(1.)).p_0().border_0())
    }

    fn render_preview(&self, cx: &mut Context<Self>) -> impl IntoElement {
        div().size_full().child(
            TextView::new(&self.preview)
                .image_source({
                    let base = self
                        .path
                        .as_ref()
                        .and_then(|path| path.parent().map(Path::to_path_buf))
                        .unwrap_or_else(|| PathBuf::from("."));
                    move |uri| {
                        let raw = uri.as_ref();
                        let path = PathBuf::from(raw.strip_prefix("file://").unwrap_or(raw));
                        let path = if path.is_absolute() {
                            path
                        } else {
                            base.join(path)
                        };
                        ImageSource::from(path)
                    }
                })
                .markdown_extensions(markdown_extensions())
                .plugin(MathPlugin)
                .plugin(InlineMathPlugin)
                .on_task_toggle({
                    let this = cx.weak_entity();
                    move |event, window, cx| {
                        _ = this.update(cx, |document, cx| {
                            document.toggle_task(event.checked(), event.marker_range(), window, cx);
                        });
                    }
                })
                .on_link_click({
                    let owner = self.owner.clone();
                    let base = self
                        .path
                        .as_ref()
                        .and_then(|path| path.parent().map(Path::to_path_buf));
                    move |url, event, window, cx| {
                        if event.is_right_click() {
                            return;
                        }
                        if let Some(encoded) = url.strip_prefix("mdpeek-wiki:") {
                            let Some(owner) = owner.clone() else { return };
                            let target = decode_wiki_target(encoded);
                            let target = if Path::new(&target).extension().is_some() {
                                target
                            } else {
                                format!("{target}.md")
                            };
                            let path = base
                                .as_ref()
                                .map(|base| base.join(&target))
                                .unwrap_or_else(|| PathBuf::from(&target));
                            _ = owner.update(cx, |app, cx| app.open_path(path, window, cx));
                        } else if url.starts_with("http://")
                            || url.starts_with("https://")
                            || url.starts_with("mailto:")
                        {
                            cx.open_url(url);
                        } else if !url.starts_with('#') {
                            let path = base
                                .as_ref()
                                .map(|base| base.join(url.as_str()))
                                .unwrap_or_else(|| PathBuf::from(url.as_str()));
                            if path.exists()
                                && let Some(owner) = owner.clone()
                            {
                                _ = owner.update(cx, |app, cx| app.open_path(path, window, cx));
                            }
                        }
                    }
                })
                .code_block_actions(|code_block, _, _| {
                    h_flex().child(Clipboard::new("copy").value(code_block.code()))
                })
                .table_actions(|table, _, cx| {
                    h_flex()
                        .w_full()
                        .justify_end()
                        .items_center()
                        .gap_1()
                        .child(
                            div()
                                .text_xs()
                                .text_color(cx.theme().muted_foreground)
                                .child(format!("{} × {}", table.rows.len(), table.headers.len())),
                        )
                        .child(
                            Clipboard::new("copy-table-markdown")
                                .value(table.markdown.clone())
                                .tooltip("Copy as Markdown"),
                        )
                        .child(
                            Clipboard::new("copy-table-csv")
                                .value(table_to_csv(&table.headers, &table.rows))
                                .tooltip("Copy as CSV"),
                        )
                        .child(
                            Clipboard::new("copy-table-tsv")
                                .value(table_to_tsv(&table.headers, &table.rows))
                                .tooltip("Copy as TSV"),
                        )
                })
                .text_size(rems(self.preview_zoom))
                .px_5()
                .py_4()
                .scrollable(true)
                .selectable(true)
                .bg(cx.theme().background),
        )
    }

    fn render_content(&self, cx: &mut Context<Self>) -> AnyElement {
        if self.kind == DocumentKind::Image {
            return if let Some(path) = self.path.clone() {
                div()
                    .size_full()
                    .overflow_hidden()
                    .flex()
                    .items_center()
                    .justify_center()
                    .bg(cx.theme().secondary.opacity(0.25))
                    .child(
                        img(path)
                            .object_fit(ObjectFit::Contain)
                            .max_w_full()
                            .max_h_full(),
                    )
                    .into_any_element()
            } else {
                div()
                    .size_full()
                    .items_center()
                    .justify_center()
                    .text_color(cx.theme().muted_foreground)
                    .child("No image loaded")
                    .into_any_element()
            };
        }

        match self.mode {
            ViewMode::Edit => self.render_editor().into_any_element(),
            ViewMode::Preview => self.render_preview(cx).into_any_element(),
            ViewMode::Split => h_resizable("document-split")
                .child(resizable_panel().child(self.render_editor()))
                .child(resizable_panel().child(self.render_preview(cx)))
                .into_any_element(),
        }
    }

    fn render_status(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let value = self.editor.read(cx).value().to_string();
        let words = value.split_whitespace().count();
        let lines = value.lines().count();
        let characters = value.chars().count();
        let path = self
            .path
            .as_ref()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|| "Unsaved document".to_string());

        StatusBar::new()
            .left(
                h_flex()
                    .gap_2()
                    .child(
                        div()
                            .text_xs()
                            .text_color(cx.theme().muted_foreground)
                            .child(path),
                    )
                    .when(self.dirty, |this| {
                        this.child(
                            div()
                                .text_xs()
                                .text_color(cx.theme().warning)
                                .child("Modified"),
                        )
                    }),
            )
            .right(
                h_flex()
                    .gap_3()
                    .child(
                        div()
                            .text_xs()
                            .text_color(cx.theme().muted_foreground)
                            .child(format!("{lines} lines")),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(cx.theme().muted_foreground)
                            .child(format!("{words} words")),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(cx.theme().muted_foreground)
                            .child(format!("{characters} chars")),
                    ),
            )
    }
}

impl Render for DocumentView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        v_flex()
            .size_full()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .child(self.render_toolbar(cx))
            .child(
                div()
                    .flex_1()
                    .overflow_hidden()
                    .child(self.render_content(cx)),
            )
            .child(self.render_status(cx))
    }
}

fn table_to_csv(headers: &[String], rows: &[Vec<String>]) -> String {
    let field = |cell: &str| {
        if cell.contains(['"', ',', '\n']) {
            format!("\"{}\"", cell.replace('"', "\"\""))
        } else {
            cell.to_string()
        }
    };
    let line = |cells: &[String]| {
        cells
            .iter()
            .map(|cell| field(cell))
            .collect::<Vec<_>>()
            .join(",")
    };
    std::iter::once(line(headers))
        .chain(rows.iter().map(|row| line(row)))
        .collect::<Vec<_>>()
        .join("\n")
}

fn table_to_tsv(headers: &[String], rows: &[Vec<String>]) -> String {
    let field = |cell: &str| {
        cell.replace('\t', "\\t")
            .replace('\n', "\\n")
            .replace('\r', "\\r")
    };
    let line = |cells: &[String]| {
        cells
            .iter()
            .map(|cell| field(cell))
            .collect::<Vec<_>>()
            .join("\t")
    };
    std::iter::once(line(headers))
        .chain(rows.iter().map(|row| line(row)))
        .collect::<Vec<_>>()
        .join("\n")
}

fn markdown_extensions() -> MarkdownExtensions {
    MarkdownExtensions::default()
        .frontmatter()
        .mdx()
        .block_surface("note", |_, cx| alert_surface(cx, cx.theme().info))
        .block_surface("tip", |_, cx| alert_surface(cx, cx.theme().success))
        .block_surface("warning", |_, cx| alert_surface(cx, cx.theme().warning))
        .block_surface("caution", |_, cx| alert_surface(cx, cx.theme().danger))
        .block_surface("important", |_, cx| alert_surface(cx, cx.theme().primary))
}

fn alert_surface(cx: &App, color: Hsla) -> Div {
    v_flex()
        .p_3()
        .rounded(cx.theme().radius_lg)
        .border_1()
        .border_color(color.opacity(0.3))
        .bg(color.opacity(0.08))
}

fn renderable_source(kind: DocumentKind, source: &str) -> String {
    if kind == DocumentKind::Markdown {
        return expand_wiki_links(source);
    }
    if kind != DocumentKind::Csv {
        return source.to_string();
    }
    crate::csv::to_markdown_table(source)
}

fn expand_wiki_links(source: &str) -> String {
    static WIKI_RE: OnceLock<regex::Regex> = OnceLock::new();
    let regex = WIKI_RE.get_or_init(|| {
        regex::Regex::new(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]]").expect("wiki link regex")
    });
    regex
        .replace_all(source, |captures: &regex::Captures<'_>| {
            let target = captures.get(1).map(|m| m.as_str()).unwrap_or_default();
            let label = captures.get(2).map(|m| m.as_str()).unwrap_or(target);
            format!("[{label}](mdpeek-wiki:{})", encode_wiki_target(target))
        })
        .into_owned()
}

fn encode_wiki_target(target: &str) -> String {
    let mut out = String::new();
    for byte in target.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'/') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn decode_wiki_target(encoded: &str) -> String {
    let bytes = encoded.as_bytes();
    let mut out = Vec::new();
    let mut ix = 0;
    while ix < bytes.len() {
        if bytes[ix] == b'%'
            && ix + 2 < bytes.len()
            && let Ok(value) = u8::from_str_radix(&encoded[ix + 1..ix + 3], 16)
        {
            out.push(value);
            ix += 3;
            continue;
        }
        out.push(bytes[ix]);
        ix += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn read_document(path: &Path) -> Result<(String, DocumentKind)> {
    let kind = DocumentKind::from_path(path);
    let content = if kind == DocumentKind::Image {
        String::new()
    } else {
        std::fs::read_to_string(path)?
    };
    Ok((content, kind))
}

use std::path::{Path, PathBuf};

use gpui_kit::component::{
    ActiveTheme as _, Sizable as _,
    button::{Button, ButtonVariants as _},
    clipboard::Clipboard,
    h_flex,
    input::{Editor, EditorState, InputEvent, TabSize},
    resizable::{h_resizable, resizable_panel},
    status_bar::StatusBar,
    text::{TextView, TextViewState},
    v_flex,
};
use gpui_kit::{prelude::FluentBuilder as _, *};

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
    preview_zoom: f32,
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
        let preview = cx.new(|cx| TextViewState::markdown(content.as_str(), cx));
        let focus_handle = editor.focus_handle(cx);
        window.defer(cx, move |window, cx| {
            focus_handle.focus(window, cx);
        });

        let _subscriptions = vec![cx.subscribe(&editor, |this, _, event: &InputEvent, cx| {
            if matches!(event, InputEvent::Change) {
                let value = this.editor.read(cx).value().to_string();
                this.dirty = value != this.saved_value;
                this.preview
                    .update(cx, |preview, cx| preview.set_text(&value, cx));
                cx.notify();
            }
        })];

        Self {
            path,
            kind,
            editor,
            preview,
            mode: if kind == DocumentKind::Markdown {
                ViewMode::Split
            } else {
                ViewMode::Edit
            },
            saved_value: content,
            dirty: false,
            preview_zoom: 1.0,
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
        self.path = Some(path);
        cx.notify();
    }

    pub fn reload_from_disk(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Result<()> {
        let Some(path) = self.path.clone() else {
            return Ok(());
        };
        let content = std::fs::read_to_string(path)?;
        self.editor.update(cx, |editor, cx| {
            editor.set_value(content.clone(), window, cx);
        });
        self.preview
            .update(cx, |preview, cx| preview.set_text(&content, cx));
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
                .code_block_actions(|code_block, _, _| {
                    h_flex().child(Clipboard::new("copy").value(code_block.code()))
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
        if !self.kind.is_text_editable() {
            return div()
                .size_full()
                .items_center()
                .justify_center()
                .text_color(cx.theme().muted_foreground)
                .child("Image viewing is not yet available in the native rebuild")
                .into_any_element();
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

pub fn read_document(path: &Path) -> Result<(String, DocumentKind)> {
    let kind = DocumentKind::from_path(path);
    let content = if kind == DocumentKind::Image {
        String::new()
    } else {
        std::fs::read_to_string(path)?
    };
    Ok((content, kind))
}

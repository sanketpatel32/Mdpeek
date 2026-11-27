use std::{
    cell::Cell,
    path::{Path as StdPath, PathBuf},
    rc::Rc,
};

use gpui_kit::component::{
    ActiveTheme as _, Icon, IconName, Selectable as _, Sizable as _, StyledExt as _, Theme,
    ThemeMode, WindowExt as _,
    button::{Button, ButtonVariants as _},
    checkbox::Checkbox,
    command::{Command, CommandItem, CommandState},
    h_flex,
    input::{Input, InputEvent, InputState},
    list::ListItem,
    scroll::ScrollableElement,
    tab::{Tab, TabBar},
    tree::{TreeState, tree},
    v_flex,
};
use gpui_kit::{prelude::FluentBuilder as _, *};

use crate::document::{DocumentView, read_document};
use crate::export::{markdown_to_html_document, markdown_to_pdf, markdown_to_plain_text};
use crate::settings::{
    AppSettings, SessionState, load_session, load_settings, save_session, save_settings,
};
use crate::table::{MarkdownTable, emit_table};
use crate::workspace::{
    SearchMatch, build_file_items, collect_files, resolve_tree_path, search_files,
};

actions!(
    mdpeek,
    [
        NewTab,
        OpenFile,
        OpenSettings,
        NavigateBack,
        NavigateForward,
        ZoomIn,
        ZoomOut,
        ZoomReset,
        QuickOpen,
        QuickOpenPick,
        CommandPalette,
        CommandPalettePick,
        SnippetPicker,
        SnippetPick,
        EditTable,
        GoToLine,
        DuplicateLines,
        MoveLinesUp,
        MoveLinesDown,
        JoinLines,
        SortLinesAscending,
        SortLinesDescending,
        UppercaseSelection,
        LowercaseSelection,
        TitleCaseSelection,
        ToggleCaseSelection,
        InsertToc,
        InsertDate,
        ItalicSelection,
        InlineCodeSelection,
        LinkSelection,
        StrikethroughSelection,
        QuoteSelection,
        CheckLinks,
        DailyNote,
        WorkspaceSearch,
        WorkspaceSearchPick,
        WorkspaceReplace,
        ToggleReading,
        OpenFolder,
        Save,
        SaveAs,
        CloseTab,
        CloseOtherTabs,
        CloseTabsToRight,
        CloseAllTabs,
        ToggleEdit,
        ToggleSidebar,
        ToggleTheme,
        ReloadFile,
        ReopenClosedTab,
        ExportHtml,
        CopyHtml,
        CopyPlainText,
        OpenInBrowser,
        ExportText,
        ExportPdf,
        NextTab,
        PreviousTab,
        Quit
    ]
);

pub struct Mdpeek {
    documents: Vec<Entity<DocumentView>>,
    active: usize,
    closed_paths: Vec<PathBuf>,
    sidebar_visible: bool,
    root_dir: Option<PathBuf>,
    tree_state: Entity<TreeState>,
    status_message: Option<SharedString>,
    quick_open: Entity<CommandState>,
    workspace_search: Entity<CommandState>,
    command_palette: Entity<CommandState>,
    snippet_picker: Entity<CommandState>,
    search_results: Vec<SearchMatch>,
    reading_mode: bool,
    navigation_history: Vec<PathBuf>,
    navigation_index: usize,
    settings: AppSettings,
    focus_handle: FocusHandle,
}

fn markdown_headings(source: &str) -> Vec<(usize, String, usize)> {
    let mut headings = Vec::new();
    let mut in_fence = false;
    let mut offset = 0;
    for line in source.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
        } else if !in_fence {
            let level = trimmed.chars().take_while(|ch| *ch == '#').count();
            if (1..=6).contains(&level) && trimmed[level..].starts_with(char::is_whitespace) {
                let text = trimmed[level..]
                    .trim()
                    .trim_end_matches('#')
                    .trim()
                    .to_string();
                if !text.is_empty() {
                    headings.push((level, text, offset));
                }
            }
        }
        offset += line.len() + 1;
    }
    headings
}

fn snippet_entries() -> Vec<(&'static str, &'static str)> {
    vec![
        ("Note callout", "> [!NOTE]\nUseful information.\n"),
        ("Warning callout", "> [!WARNING]\nImportant caution.\n"),
        ("Task list", "- [ ] First task\n- [ ] Second task\n"),
        (
            "Table",
            "| Column | Value |\n| --- | --- |\n| Item | Text |\n",
        ),
        ("Code block", "```rust\n\n```\n"),
        ("Inline math", "$E = mc^2$"),
        ("Block math", "$$\nE = mc^2\n$$\n"),
        (
            "Mermaid diagram",
            "```mermaid\nflowchart TD\n  A[Start] --> B[Done]\n```\n",
        ),
        ("Frontmatter", "---\ntitle: Document\ntags: []\n---\n\n"),
        (
            "Details disclosure",
            "<details>\n<summary>More</summary>\n\nHidden details.\n\n</details>\n",
        ),
        (
            "Footnote",
            "Text with a footnote.[^1]\n\n[^1]: Footnote text.\n",
        ),
        ("Link", "[Link text](https://example.com)"),
        ("Image", "![Alt text](image.png)"),
    ]
}

fn command_palette_entries() -> Vec<(&'static str, &'static str)> {
    vec![
        ("New document", "Ctrl+N"),
        ("Open file", "Ctrl+O"),
        ("Open folder", "Ctrl+Shift+E"),
        ("Quick open", "Ctrl+P"),
        ("Search workspace", "Ctrl+Shift+F"),
        ("Insert snippet", "Ctrl+Shift+S"),
        ("Edit table at cursor", "Ctrl+Alt+M"),
        ("Replace in workspace", "Ctrl+Shift+R"),
        ("Open today's daily note", "Ctrl+Shift+D"),
        ("Check document links", "Ctrl+Alt+I"),
        ("Save", "Ctrl+S"),
        ("Save as", "Ctrl+Alt+S"),
        ("Reload file", "Ctrl+R"),
        ("Reopen closed tab", "Ctrl+Alt+T"),
        ("Cycle edit/preview", "Ctrl+E"),
        ("Toggle sidebar", "Ctrl+B"),
        ("Toggle reading mode", "F11"),
        ("Toggle theme", "Ctrl+Shift+L"),
        ("Export HTML", "Ctrl+Shift+H"),
        ("Copy as HTML", ""),
        ("Copy as plain text", ""),
        ("Open rendered document in browser", ""),
        ("Export plain text", "Ctrl+Shift+T"),
        ("Export PDF", "Ctrl+Shift+P"),
        ("Go to line", "Ctrl+G"),
        ("Duplicate line", "Ctrl+D"),
        ("Move line up", "Alt+Up"),
        ("Move line down", "Alt+Down"),
        ("Join line with next", "Ctrl+J"),
        ("Sort lines A to Z", ""),
        ("Sort lines Z to A", ""),
        ("UPPERCASE selection", ""),
        ("lowercase selection", ""),
        ("Title Case selection", ""),
        ("tOGGLE cASE selection", ""),
        ("Insert table of contents", ""),
        ("Insert today's date", ""),
        ("Zoom in", "Ctrl+="),
        ("Zoom out", "Ctrl+-"),
        ("Reset zoom", "Ctrl+0"),
        ("Back", "Alt+Left"),
        ("Forward", "Alt+Right"),
        ("Close other tabs", ""),
        ("Close tabs to the right", ""),
        ("Close all tabs", ""),
        ("Close tab", "Ctrl+W"),
        ("Open settings", "Ctrl+,"),
        ("Quit", "Ctrl+Q"),
    ]
}

#[derive(Clone, Copy)]
enum TableOperation {
    None,
    AddRow,
    AddColumn,
    RemoveRow(usize),
    MoveRow(usize, bool),
    RemoveColumn(usize),
    MoveColumn(usize, bool),
    CycleAlignment(usize),
}

impl TableOperation {
    fn reopens_editor(self) -> bool {
        !matches!(self, Self::None)
    }

    fn status_message(self) -> &'static str {
        match self {
            Self::None => "Updated table",
            Self::AddRow => "Added table row",
            Self::AddColumn => "Added table column",
            Self::RemoveRow(_) => "Removed table row",
            Self::MoveRow(_, _) => "Moved table row",
            Self::RemoveColumn(_) => "Removed table column",
            Self::MoveColumn(_, _) => "Moved table column",
            Self::CycleAlignment(_) => "Changed column alignment",
        }
    }
}

#[derive(Clone, Copy)]
enum EditorLineOperation {
    Duplicate,
    MoveUp,
    MoveDown,
    Join,
}

#[derive(Clone, Copy)]
enum SettingsToggle {
    LineNumbers,
    WordWrap,
    Autosave,
}

#[derive(Clone, Copy)]
enum ZoomOperation {
    In,
    Out,
    Reset,
}

impl Mdpeek {
    pub fn new(window: &mut Window, cx: &mut Context<Self>, initial_paths: &[PathBuf]) -> Self {
        let session = load_session();
        let mut this = Self {
            documents: Vec::new(),
            active: 0,
            closed_paths: Vec::new(),
            sidebar_visible: session.sidebar_visible,
            root_dir: session.root_dir.clone(),
            tree_state: cx.new(|cx| TreeState::new(cx)),
            status_message: None,
            quick_open: cx.new(|cx| CommandState::new(window, cx)),
            workspace_search: cx.new(|cx| CommandState::new(window, cx)),
            command_palette: cx.new(|cx| CommandState::new(window, cx)),
            snippet_picker: cx.new(|cx| CommandState::new(window, cx)),
            search_results: Vec::new(),
            reading_mode: false,
            navigation_history: Vec::new(),
            navigation_index: 0,
            settings: load_settings(),
            focus_handle: cx.focus_handle(),
        };
        if session.dark_mode {
            Theme::change(ThemeMode::Dark, None, cx);
        }
        if let Some(root) = session.root_dir.clone() {
            this.open_folder(root, cx);
            this.sidebar_visible = session.sidebar_visible;
        }
        let paths = if initial_paths.is_empty() {
            session.open_paths.clone()
        } else {
            initial_paths.to_vec()
        };
        for path in paths {
            if path.is_dir() {
                this.open_folder(path, cx);
            } else {
                this.open_path(path, window, cx);
            }
        }
        if initial_paths.is_empty() {
            this.active = session.active.min(this.documents.len().saturating_sub(1));
        }
        cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor()
                    .timer(std::time::Duration::from_secs(2))
                    .await;
                if this
                    .update_in(cx, |this, window, cx| {
                        this.reload_externally_changed(window, cx)
                    })
                    .is_err()
                {
                    break;
                }
            }
        })
        .detach();
        this
    }

    pub fn view(window: &mut Window, cx: &mut App, initial_paths: &[PathBuf]) -> Entity<Self> {
        cx.new(|cx| Self::new(window, cx, initial_paths))
    }

    fn persist(&self, cx: &App) {
        let state = SessionState {
            open_paths: self
                .documents
                .iter()
                .filter_map(|document| document.read(cx).path.clone())
                .collect(),
            active: self.active,
            root_dir: self.root_dir.clone(),
            sidebar_visible: self.sidebar_visible,
            dark_mode: cx.theme().is_dark(),
        };
        if let Err(error) = save_session(&state) {
            eprintln!("could not save mdpeek session: {error}");
        }
    }

    fn active_document(&self) -> Option<Entity<DocumentView>> {
        self.documents.get(self.active).cloned()
    }

    fn set_status(&mut self, message: impl Into<SharedString>, cx: &mut Context<Self>) {
        self.status_message = Some(message.into());
        cx.notify();
    }

    fn clear_status(&mut self, cx: &mut Context<Self>) {
        self.status_message = None;
        cx.notify();
    }

    fn new_tab(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let owner = cx.weak_entity();
        let document = cx.new(|cx| DocumentView::untitled(window, cx));
        let settings = self.settings.clone();
        document.update(cx, |document, cx| {
            document.set_owner(owner);
            document.apply_editor_settings(&settings, window, cx);
        });
        self.documents.push(document);
        self.active = self.documents.len() - 1;
        self.clear_status(cx);
    }

    fn open_file_action(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let paths = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: true,
            prompt: Some("Open Markdown, text, code, or image files".into()),
        });

        cx.spawn_in(window, async move |this, window| {
            let Ok(Ok(Some(paths))) = paths.await else {
                return;
            };
            _ = this.update_in(window, |this, window, cx| {
                for path in paths {
                    this.open_path(path, window, cx);
                }
            });
        })
        .detach();
    }

    fn open_folder_action(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let paths = cx.prompt_for_paths(PathPromptOptions {
            files: false,
            directories: true,
            multiple: false,
            prompt: Some("Open a folder".into()),
        });

        cx.spawn_in(window, async move |this, window| {
            let Ok(Ok(Some(paths))) = paths.await else {
                return;
            };
            let Some(path) = paths.into_iter().next() else {
                return;
            };
            _ = this.update_in(window, |this, _, cx| {
                this.open_folder(path, cx);
            });
        })
        .detach();
    }

    fn open_folder(&mut self, path: PathBuf, cx: &mut Context<Self>) {
        let items = build_file_items(&path);
        self.tree_state.update(cx, |tree, cx| {
            tree.set_items(items, cx);
        });
        self.root_dir = Some(path.clone());
        self.sidebar_visible = true;
        self.set_status(format!("Opened {}", path.display()), cx);
    }

    pub fn open_path(&mut self, path: PathBuf, window: &mut Window, cx: &mut Context<Self>) {
        self.open_path_with_history(path, true, window, cx);
    }

    fn open_path_with_history(
        &mut self,
        path: PathBuf,
        record: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let Some(index) = self.documents.iter().position(|document| {
            document
                .read(cx)
                .path
                .as_ref()
                .is_some_and(|open| *open == path)
        }) {
            self.active = index;
            if self.documents[index].read(cx).kind == crate::document::DocumentKind::Image {
                self.focus_handle.focus(window, cx);
            }
            if record {
                self.record_navigation(path);
            }
            cx.notify();
            return;
        }

        let this_settings = self.settings.clone();
        match read_document(&path) {
            Ok((content, kind)) => {
                let owner = cx.weak_entity();
                let document =
                    cx.new(|cx| DocumentView::new(Some(path.clone()), content, kind, window, cx));
                document.update(cx, |document, cx| {
                    document.set_owner(owner);
                    document.apply_editor_settings(&this_settings, window, cx);
                });
                let is_image = kind == crate::document::DocumentKind::Image;
                self.documents.push(document);
                self.active = self.documents.len() - 1;
                if is_image {
                    self.focus_handle.focus(window, cx);
                }
                if record {
                    self.record_navigation(path);
                }
                self.clear_status(cx);
            }
            Err(error) => {
                self.set_status(format!("Could not open {}: {error}", path.display()), cx);
            }
        }
    }

    fn close_tab(&mut self, index: usize, cx: &mut Context<Self>) {
        if index >= self.documents.len() {
            return;
        }
        let document = self.documents.remove(index);
        if let Some(path) = document.read(cx).path.clone() {
            self.closed_paths.push(path);
        }
        if self.documents.is_empty() {
            self.active = 0;
        } else {
            self.active = self.active.min(self.documents.len() - 1);
        }
        cx.notify();
    }

    fn zoom_active(&mut self, operation: ZoomOperation, cx: &mut Context<Self>) {
        let Some(document) = self.active_document() else {
            return;
        };
        document.update(cx, |document, cx| match operation {
            ZoomOperation::In => document.zoom_in(cx),
            ZoomOperation::Out => document.zoom_out(cx),
            ZoomOperation::Reset => document.zoom_reset(cx),
        });
    }

    fn record_navigation(&mut self, path: PathBuf) {
        if self.navigation_history.get(self.navigation_index) == Some(&path) {
            return;
        }
        self.navigation_history.truncate(self.navigation_index + 1);
        self.navigation_history.push(path);
        self.navigation_index = self.navigation_history.len() - 1;
    }

    fn navigate_history(&mut self, backward: bool, window: &mut Window, cx: &mut Context<Self>) {
        let next_index = if backward {
            self.navigation_index.checked_sub(1)
        } else {
            (self.navigation_index + 1 < self.navigation_history.len())
                .then_some(self.navigation_index + 1)
        };
        let Some(next_index) = next_index else {
            self.set_status(
                if backward {
                    "No earlier document"
                } else {
                    "No later document"
                },
                cx,
            );
            return;
        };
        let Some(path) = self.navigation_history.get(next_index).cloned() else {
            return;
        };
        self.navigation_index = next_index;
        self.open_path_with_history(path, false, window, cx);
    }

    fn close_other_tabs(&mut self, cx: &mut Context<Self>) {
        for index in (0..self.documents.len()).rev() {
            if index != self.active {
                self.close_tab(index, cx);
                if index < self.active {
                    self.active = self.active.saturating_sub(1);
                }
            }
        }
    }

    fn close_tabs_to_right(&mut self, cx: &mut Context<Self>) {
        for index in ((self.active + 1)..self.documents.len()).rev() {
            self.close_tab(index, cx);
        }
    }

    fn close_all_tabs(&mut self, cx: &mut Context<Self>) {
        while !self.documents.is_empty() {
            let index = self.documents.len() - 1;
            self.close_tab(index, cx);
        }
    }

    fn close_active_tab(&mut self, cx: &mut Context<Self>) {
        self.close_tab(self.active, cx);
    }

    fn reopen_closed_tab(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(path) = self.closed_paths.pop() else {
            self.set_status("No closed tab to reopen", cx);
            return;
        };
        self.open_path(path, window, cx);
    }

    fn save_active(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(document) = self.active_document() else {
            return;
        };
        let path = document.read(cx).path.clone();
        if let Some(path) = path {
            let content = document.read(cx).value(cx);
            match std::fs::write(&path, content) {
                Ok(()) => {
                    document.update(cx, |document, cx| {
                        document.mark_saved(path.clone(), cx);
                    });
                    self.set_status(format!("Saved {}", path.display()), cx);
                }
                Err(error) => {
                    self.set_status(format!("Could not save {}: {error}", path.display()), cx);
                }
            }
        } else {
            self.save_active_as(window, cx);
        }
    }

    fn save_active_as(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(document) = self.active_document() else {
            return;
        };
        let title = document.read(cx).title().to_string();
        let start_dir = document
            .read(cx)
            .path
            .as_ref()
            .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
            .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
            .unwrap_or_else(std::env::temp_dir);
        let receiver = cx.prompt_for_new_path(&start_dir, Some(title.as_str()));

        cx.spawn_in(window, async move |this, window| {
            let Some(path) = receiver.await.ok().into_iter().flatten().flatten().next() else {
                return;
            };

            _ = this.update_in(window, |this, window, cx| {
                this.finish_save_as(document, path, window, cx);
            });
        })
        .detach();
    }

    fn finish_save_as(
        &mut self,
        document: Entity<DocumentView>,
        path: PathBuf,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let content = document.read(cx).value(cx);
        match std::fs::write(&path, content) {
            Ok(()) => {
                document.update(cx, |document, cx| {
                    document.mark_saved(path.clone(), cx);
                });
                self.set_status(format!("Saved {}", path.display()), cx);
            }
            Err(error) => {
                self.set_status(format!("Could not save {}: {error}", path.display()), cx);
            }
        }
    }

    fn reload_active(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(document) = self.active_document() else {
            return;
        };
        let result = document.update(cx, |document, cx| document.reload_from_disk(window, cx));
        match result {
            Ok(()) => self.set_status("Reloaded from disk", cx),
            Err(error) => self.set_status(format!("Could not reload: {error}"), cx),
        }
    }

    fn copy_active_html(&mut self, cx: &mut Context<Self>) {
        let Some(document) = self.active_document() else {
            return;
        };
        let (title, content) = document.read_with(cx, |document, cx| {
            (document.title().to_string(), document.value(cx))
        });
        cx.write_to_clipboard(ClipboardItem::new_string(markdown_to_html_document(
            &title, &content,
        )));
        self.set_status("Copied rendered HTML", cx);
    }

    fn copy_active_plain_text(&mut self, cx: &mut Context<Self>) {
        let Some(document) = self.active_document() else {
            return;
        };
        let content = document.read_with(cx, |document, cx| document.value(cx));
        cx.write_to_clipboard(ClipboardItem::new_string(markdown_to_plain_text(&content)));
        self.set_status("Copied plain text", cx);
    }

    fn open_active_in_browser(&mut self, cx: &mut Context<Self>) {
        let Some(document) = self.active_document() else {
            return;
        };
        let (title, content) = document.read_with(cx, |document, cx| {
            (document.title().to_string(), document.value(cx))
        });
        let safe_name = title
            .chars()
            .map(|ch| {
                if ch.is_ascii_alphanumeric() || ch == '-' {
                    ch
                } else {
                    '-'
                }
            })
            .collect::<String>();
        let path = std::env::temp_dir().join(format!("mdpeek-{safe_name}.html"));
        match std::fs::write(&path, markdown_to_html_document(&title, &content)) {
            Ok(()) => {
                cx.open_url(&format!("file://{}", path.display()));
                self.set_status("Opened rendered document in browser", cx);
            }
            Err(error) => self.set_status(format!("Could not open in browser: {error}"), cx),
        }
    }

    fn export_active_html(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(document) = self.active_document() else {
            return;
        };
        let title = document.read(cx).title().to_string();
        let content = document.read(cx).value(cx);
        let start_dir = document
            .read(cx)
            .path
            .as_ref()
            .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
            .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
            .unwrap_or_else(std::env::temp_dir);
        let file_name = format!("{}.html", title.trim_end_matches(".md"));
        let receiver = cx.prompt_for_new_path(&start_dir, Some(file_name.as_str()));

        cx.spawn_in(window, async move |this, window| {
            let Some(path) = receiver.await.ok().into_iter().flatten().flatten().next() else {
                return;
            };
            let html = markdown_to_html_document(&title, &content);
            let result = std::fs::write(&path, html);
            _ = this.update_in(window, |this, _, cx| match result {
                Ok(()) => this.set_status(format!("Exported {}", path.display()), cx),
                Err(error) => this.set_status(format!("Could not export HTML: {error}"), cx),
            });
        })
        .detach();
    }

    fn export_active_text(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(document) = self.active_document() else {
            return;
        };
        let title = document.read(cx).title().to_string();
        let content = document.read(cx).value(cx);
        let start_dir = document
            .read(cx)
            .path
            .as_ref()
            .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
            .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
            .unwrap_or_else(std::env::temp_dir);
        let file_name = format!("{}.txt", title.trim_end_matches(".md"));
        let receiver = cx.prompt_for_new_path(&start_dir, Some(file_name.as_str()));

        cx.spawn_in(window, async move |this, window| {
            let Some(path) = receiver.await.ok().into_iter().flatten().flatten().next() else {
                return;
            };
            let text = markdown_to_plain_text(&content);
            let result = std::fs::write(&path, text);
            _ = this.update_in(window, |this, _, cx| match result {
                Ok(()) => this.set_status(format!("Exported {}", path.display()), cx),
                Err(error) => this.set_status(format!("Could not export text: {error}"), cx),
            });
        })
        .detach();
    }

    fn export_active_pdf(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(document) = self.active_document() else {
            return;
        };
        let title = document.read(cx).title().to_string();
        let content = document.read(cx).value(cx);
        let start_dir = document
            .read(cx)
            .path
            .as_ref()
            .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
            .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
            .unwrap_or_else(std::env::temp_dir);
        let file_name = format!("{}.pdf", title.trim_end_matches(".md"));
        let receiver = cx.prompt_for_new_path(&start_dir, Some(file_name.as_str()));

        cx.spawn_in(window, async move |this, window| {
            let Some(path) = receiver.await.ok().into_iter().flatten().flatten().next() else {
                return;
            };
            let pdf = markdown_to_pdf(&title, &content);
            let result = std::fs::write(&path, pdf);
            _ = this.update_in(window, |this, _, cx| match result {
                Ok(()) => this.set_status(format!("Exported {}", path.display()), cx),
                Err(error) => this.set_status(format!("Could not export PDF: {error}"), cx),
            });
        })
        .detach();
    }

    fn select_tab(&mut self, index: usize, cx: &mut Context<Self>) {
        if index < self.documents.len() {
            self.active = index;
            cx.notify();
        }
    }

    fn step_tab(&mut self, delta: isize, cx: &mut Context<Self>) {
        if self.documents.is_empty() {
            return;
        }
        let len = self.documents.len() as isize;
        self.active = ((self.active as isize + delta).rem_euclid(len)) as usize;
        cx.notify();
    }

    fn toggle_edit(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(document) = self.active_document() {
            document.update(cx, |document, cx| document.toggle_edit(cx));
        }
        self.focus_handle.focus(window, cx);
    }

    fn toggle_theme(&mut self, cx: &mut Context<Self>) {
        let next = if cx.theme().is_dark() {
            ThemeMode::Light
        } else {
            ThemeMode::Dark
        };
        Theme::change(next, None, cx);
    }

    fn reload_externally_changed(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.autosave_dirty_documents(cx);
        for document in self.documents.clone() {
            let (path, dirty, changed) = document.read_with(cx, |document, _| {
                (
                    document.path.clone(),
                    document.is_dirty(),
                    document.externally_changed(),
                )
            });
            if !changed {
                continue;
            }
            if dirty {
                if let Some(path) = path {
                    self.set_status(
                        format!(
                            "{} changed on disk; save or reload carefully",
                            path.display()
                        ),
                        cx,
                    );
                }
                continue;
            }
            if document
                .update(cx, |document, cx| document.reload_from_disk(window, cx))
                .is_ok()
            {
                self.set_status("Reloaded file changed on disk", cx);
            }
        }
    }

    fn autosave_dirty_documents(&mut self, cx: &mut Context<Self>) {
        if !self.settings.autosave {
            return;
        }
        for document in self.documents.clone() {
            let Some((path, content)) = document.read_with(cx, |document, cx| {
                (document.is_dirty() && document.kind.is_text_editable())
                    .then(|| (document.path.clone(), document.value(cx)))
                    .and_then(|(path, content)| path.map(|path| (path, content)))
            }) else {
                continue;
            };
            match std::fs::write(&path, content) {
                Ok(()) => {
                    document.update(cx, |document, cx| document.mark_saved(path.clone(), cx));
                }
                Err(error) => {
                    self.set_status(
                        format!("Autosave failed for {}: {error}", path.display()),
                        cx,
                    );
                }
            }
        }
    }

    fn toggle_setting(
        &mut self,
        setting: SettingsToggle,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match setting {
            SettingsToggle::LineNumbers => {
                self.settings.editor_line_numbers = !self.settings.editor_line_numbers;
            }
            SettingsToggle::WordWrap => {
                self.settings.editor_word_wrap = !self.settings.editor_word_wrap;
            }
            SettingsToggle::Autosave => {
                self.settings.autosave = !self.settings.autosave;
            }
        }
        let settings = self.settings.clone();
        for document in self.documents.clone() {
            document.update(cx, |document, cx| {
                document.apply_editor_settings(&settings, window, cx);
            });
        }
        match save_settings(&self.settings) {
            Ok(()) => self.set_status("Settings saved", cx),
            Err(error) => self.set_status(format!("Could not save settings: {error}"), cx),
        }
    }

    fn open_settings(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let owner = cx.weak_entity();
        let current_settings = self.settings.clone();
        window.open_dialog(cx, move |dialog, _, _| {
            let owner = owner.clone();
            let current_settings = current_settings.clone();
            dialog.title("Settings").w(px(560.)).content(
                move |content, _window, cx| {
                    let line_owner = owner.clone();
                    let wrap_owner = owner.clone();
                    let autosave_owner = owner.clone();
                    let theme_owner = owner.clone();
                    content.child(
                        v_flex()
                            .w_full()
                            .gap_4()
                            .p_4()
                            .child(
                                v_flex()
                                    .gap_2()
                                    .child(div().text_sm().font_bold().child("Editor"))
                                    .child(
                                        Checkbox::new("settings-line-numbers")
                                            .label("Show line numbers")
                                            .checked(current_settings.editor_line_numbers)
                                            .on_click(move |_, window, cx| {
                                                _ = line_owner.update(cx, |this, cx| {
                                                    this.toggle_setting(SettingsToggle::LineNumbers, window, cx);
                                                });
                                            }),
                                    )
                                    .child(
                                        Checkbox::new("settings-word-wrap")
                                            .label("Wrap long lines")
                                            .checked(current_settings.editor_word_wrap)
                                            .on_click(move |_, window, cx| {
                                                _ = wrap_owner.update(cx, |this, cx| {
                                                    this.toggle_setting(SettingsToggle::WordWrap, window, cx);
                                                });
                                            }),
                                    )
                                    .child(
                                        Checkbox::new("settings-autosave")
                                            .label("Autosave saved documents")
                                            .checked(current_settings.autosave)
                                            .on_click(move |_, window, cx| {
                                                _ = autosave_owner.update(cx, |this, cx| {
                                                    this.toggle_setting(SettingsToggle::Autosave, window, cx);
                                                });
                                            }),
                                    ),
                            )
                            .child(
                                v_flex()
                                    .gap_2()
                                    .child(div().text_sm().font_bold().child("Appearance"))
                                    .child(
                                        Button::new("settings-theme")
                                            .label(if cx.theme().is_dark() { "Use light theme" } else { "Use dark theme" })
                                            .on_click(move |_, _, cx| {
                                                _ = theme_owner.update(cx, |this, cx| this.toggle_theme(cx));
                                            }),
                                    ),
                            )
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(cx.theme().muted_foreground)
                                    .child("More editor, export, and workspace preferences are still being ported from v2."),
                            ),
                    )
                },
            )
        });
    }

    fn open_command_palette(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let command = self.command_palette.clone();
        command.update(cx, |command, cx| {
            command.set_query("", window, cx);
        });
        let owner = cx.weak_entity();
        let focus_on_mount = Rc::new(Cell::new(true));
        window.open_dialog(cx, move |dialog, _, _| {
            let command = command.clone();
            let owner = owner.clone();
            let focus_on_mount = focus_on_mount.clone();
            dialog
                .close_button(false)
                .p_0()
                .content(move |content, window, cx| {
                    if focus_on_mount.replace(false) {
                        let command = command.clone();
                        window.defer(cx, move |window, cx| {
                            command.read(cx).focus_handle(cx).focus(window, cx);
                        });
                    }
                    let confirm_owner = owner.clone();
                    content.child(
                        Command::new(&command)
                            .w(px(560.))
                            .bordered(false)
                            .rounded(cx.theme().radius_lg)
                            .placeholder("Run a command...")
                            .items(command_palette_entries().iter().map(|(label, shortcut)| {
                                CommandItem::new()
                                    .label(*label)
                                    .keywords([*shortcut])
                                    .icon(IconName::Search)
                                    .action(Box::new(CommandPalettePick))
                            }))
                            .on_confirm(move |index, window, cx| {
                                let row = index.row;
                                let confirm_owner = confirm_owner.clone();
                                window.close_dialog(cx);
                                window.defer(cx, move |window, cx| {
                                    _ = confirm_owner.update(cx, |this, cx| {
                                        this.run_command_palette_row(row, window, cx);
                                    });
                                });
                            }),
                    )
                })
        });
    }

    fn run_command_palette_row(&mut self, row: usize, window: &mut Window, cx: &mut Context<Self>) {
        match row {
            0 => self.new_tab(window, cx),
            1 => self.open_file_action(window, cx),
            2 => self.open_folder_action(window, cx),
            3 => self.open_quick_open(window, cx),
            4 => self.open_workspace_search(window, cx),
            5 => self.open_snippet_picker(window, cx),
            6 => self.open_table_editor(window, cx),
            7 => self.open_workspace_replace(window, cx),
            8 => self.open_daily_note(window, cx),
            9 => self.check_links(cx),
            10 => self.save_active(window, cx),
            11 => self.save_active_as(window, cx),
            12 => self.reload_active(window, cx),
            13 => self.reopen_closed_tab(window, cx),
            14 => self.toggle_edit(window, cx),
            15 => {
                self.sidebar_visible = !self.sidebar_visible;
                cx.notify();
            }
            16 => self.toggle_reading(window, cx),
            17 => self.toggle_theme(cx),
            18 => self.export_active_html(window, cx),
            19 => self.copy_active_html(cx),
            20 => self.copy_active_plain_text(cx),
            21 => self.open_active_in_browser(cx),
            22 => self.export_active_text(window, cx),
            23 => self.export_active_pdf(window, cx),
            24 => self.open_go_to_line(window, cx),
            25 => self.apply_line_operation(EditorLineOperation::Duplicate, window, cx),
            26 => self.apply_line_operation(EditorLineOperation::MoveUp, window, cx),
            27 => self.apply_line_operation(EditorLineOperation::MoveDown, window, cx),
            28 => self.apply_line_operation(EditorLineOperation::Join, window, cx),
            29 => self.apply_text_transform(
                crate::text_transform::TransformOperation::SortAscending,
                window,
                cx,
            ),
            30 => self.apply_text_transform(
                crate::text_transform::TransformOperation::SortDescending,
                window,
                cx,
            ),
            31 => self.apply_text_transform(
                crate::text_transform::TransformOperation::Uppercase,
                window,
                cx,
            ),
            32 => self.apply_text_transform(
                crate::text_transform::TransformOperation::Lowercase,
                window,
                cx,
            ),
            33 => self.apply_text_transform(
                crate::text_transform::TransformOperation::TitleCase,
                window,
                cx,
            ),
            34 => self.apply_text_transform(
                crate::text_transform::TransformOperation::ToggleCase,
                window,
                cx,
            ),
            35 => self.apply_text_transform(
                crate::text_transform::TransformOperation::InsertToc,
                window,
                cx,
            ),
            36 => self.apply_text_transform(
                crate::text_transform::TransformOperation::InsertDate,
                window,
                cx,
            ),
            37 => self.zoom_active(ZoomOperation::In, cx),
            38 => self.zoom_active(ZoomOperation::Out, cx),
            39 => self.zoom_active(ZoomOperation::Reset, cx),
            40 => self.navigate_history(true, window, cx),
            41 => self.navigate_history(false, window, cx),
            42 => self.close_other_tabs(cx),
            43 => self.close_tabs_to_right(cx),
            44 => self.close_all_tabs(cx),
            45 => self.close_active_tab(cx),
            46 => self.open_settings(window, cx),
            47 => {
                self.persist(cx);
                cx.quit();
            }
            _ => {}
        }
    }

    fn open_snippet_picker(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.active_document().is_none() {
            self.set_status("Open a document before inserting a snippet", cx);
            return;
        }
        let command = self.snippet_picker.clone();
        command.update(cx, |command, cx| {
            command.set_query("", window, cx);
        });
        let owner = cx.weak_entity();
        let focus_on_mount = Rc::new(Cell::new(true));
        window.open_dialog(cx, move |dialog, _, _| {
            let command = command.clone();
            let owner = owner.clone();
            let focus_on_mount = focus_on_mount.clone();
            dialog
                .close_button(false)
                .p_0()
                .content(move |content, window, cx| {
                    if focus_on_mount.replace(false) {
                        let command = command.clone();
                        window.defer(cx, move |window, cx| {
                            command.read(cx).focus_handle(cx).focus(window, cx);
                        });
                    }
                    let confirm_owner = owner.clone();
                    content.child(
                        Command::new(&command)
                            .w(px(560.))
                            .bordered(false)
                            .rounded(cx.theme().radius_lg)
                            .placeholder("Insert Markdown snippet...")
                            .items(snippet_entries().iter().map(|(label, content)| {
                                CommandItem::new()
                                    .label(*label)
                                    .keywords([*content])
                                    .icon(IconName::Plus)
                                    .action(Box::new(SnippetPick))
                            }))
                            .on_confirm(move |index, window, cx| {
                                _ = confirm_owner.update(cx, |this, cx| {
                                    this.insert_snippet(index.row, window, cx);
                                });
                                window.close_dialog(cx);
                            }),
                    )
                })
        });
    }

    fn insert_snippet(&mut self, row: usize, window: &mut Window, cx: &mut Context<Self>) {
        let Some((label, content)) = snippet_entries().get(row).copied() else {
            return;
        };
        let Some(document) = self.active_document() else {
            self.set_status("Open a document before inserting a snippet", cx);
            return;
        };
        document.update(cx, |document, cx| document.insert_text(content, window, cx));
        self.set_status(format!("Inserted {label}"), cx);
    }

    fn apply_line_operation(
        &mut self,
        operation: EditorLineOperation,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(document) = self.active_document() else {
            self.set_status("Open a document before editing lines", cx);
            return;
        };
        let (kind, value, range) = document.read_with(cx, |document, cx| {
            (
                document.kind,
                document.value(cx),
                document.selected_range(cx),
            )
        });
        if !kind.is_text_editable() {
            self.set_status("Line operations require an editable text document", cx);
            return;
        }
        let result = match operation {
            EditorLineOperation::Duplicate => {
                crate::editor_ops::duplicate_lines(&value, range.start, range.end)
            }
            EditorLineOperation::MoveUp => {
                crate::editor_ops::move_lines(&value, range.start, range.end, true)
            }
            EditorLineOperation::MoveDown => {
                crate::editor_ops::move_lines(&value, range.start, range.end, false)
            }
            EditorLineOperation::Join => crate::editor_ops::join_line(&value, range.start),
        };
        if result.text == value {
            self.set_status("Line operation is not available here", cx);
            return;
        }
        document.update(cx, |document, cx| {
            document.apply_edit_result(result, window, cx);
        });
    }

    fn apply_markdown_format(
        &mut self,
        operation: crate::editor_format::FormatOperation,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(document) = self.active_document() else {
            return;
        };
        if document.read(cx).kind != crate::document::DocumentKind::Markdown {
            self.set_status("Markdown formatting requires a Markdown document", cx);
            return;
        }
        document.update(cx, |document, cx| {
            document.apply_formatting(operation, window, cx);
        });
    }

    fn toggle_sidebar_or_bold(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let editor_focused = self.active_document().is_some_and(|document| {
            document.read(cx).kind == crate::document::DocumentKind::Markdown
                && document.read(cx).editor_is_focused(window, cx)
        });
        if editor_focused {
            self.apply_markdown_format(crate::editor_format::FormatOperation::Bold, window, cx);
        } else {
            self.sidebar_visible = !self.sidebar_visible;
            cx.notify();
        }
    }

    fn apply_text_transform(
        &mut self,
        operation: crate::text_transform::TransformOperation,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(document) = self.active_document() else {
            self.set_status("Open a document before transforming text", cx);
            return;
        };
        let (kind, value, range) = document.read_with(cx, |document, cx| {
            (
                document.kind,
                document.value(cx),
                document.selected_range(cx),
            )
        });
        if !kind.is_text_editable() {
            self.set_status("Text transforms require an editable text document", cx);
            return;
        }
        let result =
            crate::text_transform::apply_transform(&value, range.start, range.end, operation);
        if result.text == value {
            self.set_status("Text transform made no changes", cx);
            return;
        }
        document.update(cx, |document, cx| {
            document.apply_edit_result(result, window, cx);
            document.focus_editor(window, cx);
        });
    }

    fn open_go_to_line(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(document) = self.active_document() else {
            self.set_status("Open a document before jumping to a line", cx);
            return;
        };
        if !document.read(cx).kind.is_text_editable() {
            self.set_status("Go to line requires an editable text document", cx);
            return;
        }
        let line_input = cx.new(|cx| InputState::new(window, cx).placeholder("Line number"));
        cx.subscribe(&line_input, |this, input, event: &InputEvent, cx| {
            if matches!(
                event,
                InputEvent::PressEnter {
                    secondary: false,
                    ..
                }
            ) {
                let line = input.read(cx).value().trim().parse::<usize>().ok();
                this.go_to_line_without_window(line, cx);
            }
        })
        .detach();
        let owner = cx.weak_entity();
        let focus_on_mount = Rc::new(Cell::new(true));
        window.open_dialog(cx, move |dialog, _, _| {
            let line_input = line_input.clone();
            let owner = owner.clone();
            let focus_on_mount = focus_on_mount.clone();
            dialog
                .title("Go to line")
                .w(px(360.))
                .content(move |content, window, cx| {
                    if focus_on_mount.replace(false) {
                        let line_input = line_input.clone();
                        window.defer(cx, move |window, cx| {
                            line_input.read(cx).focus_handle(cx).focus(window, cx);
                        });
                    }
                    let go_owner = owner.clone();
                    let go_input = line_input.clone();
                    content.child(
                        h_flex()
                            .w_full()
                            .gap_2()
                            .p_4()
                            .child(Input::new(&line_input).w_full())
                            .child(
                                Button::new("go-to-line-confirm")
                                    .primary()
                                    .label("Go")
                                    .on_click(move |_, window, cx| {
                                        let line =
                                            go_input.read(cx).value().trim().parse::<usize>().ok();
                                        _ = go_owner.update(cx, |this, cx| {
                                            this.go_to_line(line, window, cx);
                                        });
                                        window.close_dialog(cx);
                                    }),
                            ),
                    )
                })
        });
    }

    fn go_to_line_without_window(&mut self, line: Option<usize>, cx: &mut Context<Self>) {
        let Some(line) = line.filter(|line| *line > 0) else {
            self.set_status("Enter a valid line number", cx);
            return;
        };
        let Some(document) = self.active_document() else {
            return;
        };
        let offset = document.read_with(cx, |document, cx| {
            crate::editor_ops::line_start_offset(&document.value(cx), line)
        });
        let Some(offset) = offset else {
            self.set_status("Line number is outside the document", cx);
            return;
        };
        document.update(cx, |document, cx| document.select_offset(offset, cx));
        self.set_status(format!("Line {line}"), cx);
    }

    fn go_to_line(&mut self, line: Option<usize>, window: &mut Window, cx: &mut Context<Self>) {
        let Some(line) = line.filter(|line| *line > 0) else {
            self.set_status("Enter a valid line number", cx);
            return;
        };
        let Some(document) = self.active_document() else {
            return;
        };
        let offset = document.read_with(cx, |document, cx| {
            crate::editor_ops::line_start_offset(&document.value(cx), line)
        });
        let Some(offset) = offset else {
            self.set_status("Line number is outside the document", cx);
            return;
        };
        document.update(cx, |document, cx| {
            document.reveal_offset(offset, window, cx);
            document.focus_editor(window, cx);
        });
        self.set_status(format!("Line {line}"), cx);
    }

    fn open_table_editor(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(document) = self.active_document() else {
            self.set_status("Open a Markdown document before editing a table", cx);
            return;
        };
        let Some(table) = document.read_with(cx, |document, cx| document.table_at_cursor(cx))
        else {
            self.set_status("Place the cursor inside a Markdown table", cx);
            return;
        };
        if table.rows.len() > 50 || table.alignments.len() > 12 {
            self.set_status("Table is too large for the visual editor", cx);
            return;
        }
        let inputs = table
            .rows
            .iter()
            .map(|row| {
                row.iter()
                    .map(|cell| {
                        cx.new(|cx| InputState::new(window, cx).default_value(cell.clone()))
                    })
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        let owner = cx.weak_entity();
        window.open_dialog(cx, move |dialog, _, _| {
            let inputs = inputs.clone();
            let table = table.clone();
            let owner = owner.clone();
            dialog
                .title("Edit table")
                .w(px(900.))
                .content(move |content, _, cx| {
                    let column_controls = h_flex()
                        .gap_2()
                        .items_center()
                        .child(div().w(px(64.)))
                        .children((0..table.alignments.len()).map(|column| {
                            h_flex()
                                .w(px(132.))
                                .justify_center()
                                .gap_1()
                                .child(table_operation_button(
                                    ("table-column-left", column),
                                    "<",
                                    owner.clone(),
                                    table.clone(),
                                    inputs.clone(),
                                    TableOperation::MoveColumn(column, true),
                                ))
                                .child(table_operation_button(
                                    ("table-column-align", column),
                                    "A",
                                    owner.clone(),
                                    table.clone(),
                                    inputs.clone(),
                                    TableOperation::CycleAlignment(column),
                                ))
                                .child(table_operation_button(
                                    ("table-column-remove", column),
                                    "x",
                                    owner.clone(),
                                    table.clone(),
                                    inputs.clone(),
                                    TableOperation::RemoveColumn(column),
                                ))
                                .child(table_operation_button(
                                    ("table-column-right", column),
                                    ">",
                                    owner.clone(),
                                    table.clone(),
                                    inputs.clone(),
                                    TableOperation::MoveColumn(column, false),
                                ))
                                .into_any_element()
                        }))
                        .into_any_element();
                    let rows = inputs
                        .iter()
                        .enumerate()
                        .map(|(row_index, row)| {
                            h_flex()
                                .gap_2()
                                .items_center()
                                .child(
                                    v_flex()
                                        .w(px(64.))
                                        .gap_1()
                                        .child(
                                            div()
                                                .text_xs()
                                                .text_color(cx.theme().muted_foreground)
                                                .child(if row_index == 0 {
                                                    "Header".to_string()
                                                } else {
                                                    format!("Row {row_index}")
                                                }),
                                        )
                                        .when(row_index > 0, |controls| {
                                            controls.child(
                                                h_flex()
                                                    .gap_1()
                                                    .child(table_operation_button(
                                                        ("table-row-up", row_index),
                                                        "^",
                                                        owner.clone(),
                                                        table.clone(),
                                                        inputs.clone(),
                                                        TableOperation::MoveRow(row_index, true),
                                                    ))
                                                    .child(table_operation_button(
                                                        ("table-row-down", row_index),
                                                        "v",
                                                        owner.clone(),
                                                        table.clone(),
                                                        inputs.clone(),
                                                        TableOperation::MoveRow(row_index, false),
                                                    ))
                                                    .child(table_operation_button(
                                                        ("table-row-remove", row_index),
                                                        "x",
                                                        owner.clone(),
                                                        table.clone(),
                                                        inputs.clone(),
                                                        TableOperation::RemoveRow(row_index),
                                                    )),
                                            )
                                        }),
                                )
                                .children(
                                    row.iter().map(|input| {
                                        Input::new(input).w(px(132.)).into_any_element()
                                    }),
                                )
                                .into_any_element()
                        })
                        .collect::<Vec<_>>();
                    let apply_owner = owner.clone();
                    let apply_inputs = inputs.clone();
                    let apply_table = table.clone();
                    let add_row_owner = owner.clone();
                    let add_row_inputs = inputs.clone();
                    let add_row_table = table.clone();
                    let add_column_owner = owner.clone();
                    let add_column_inputs = inputs.clone();
                    let add_column_table = table.clone();
                    content.child(
                        v_flex()
                            .gap_3()
                            .p_4()
                            .child(
                                v_flex()
                                    .gap_2()
                                    .max_h(px(430.))
                                    .overflow_y_scrollbar()
                                    .child(column_controls)
                                    .children(rows),
                            )
                            .child(
                                h_flex()
                                    .justify_end()
                                    .gap_2()
                                    .child(
                                        Button::new("table-add-row")
                                            .outline()
                                            .label("Add row")
                                            .on_click(move |_, window, cx| {
                                                perform_table_operation(
                                                    add_row_owner.clone(),
                                                    add_row_table.clone(),
                                                    add_row_inputs.clone(),
                                                    TableOperation::AddRow,
                                                    window,
                                                    cx,
                                                );
                                            }),
                                    )
                                    .child(
                                        Button::new("table-add-column")
                                            .outline()
                                            .label("Add column")
                                            .on_click(move |_, window, cx| {
                                                perform_table_operation(
                                                    add_column_owner.clone(),
                                                    add_column_table.clone(),
                                                    add_column_inputs.clone(),
                                                    TableOperation::AddColumn,
                                                    window,
                                                    cx,
                                                );
                                            }),
                                    )
                                    .child(
                                        Button::new("table-apply")
                                            .primary()
                                            .label("Apply")
                                            .on_click(move |_, window, cx| {
                                                perform_table_operation(
                                                    apply_owner.clone(),
                                                    apply_table.clone(),
                                                    apply_inputs.clone(),
                                                    TableOperation::None,
                                                    window,
                                                    cx,
                                                );
                                            }),
                                    ),
                            ),
                    )
                })
        });
    }

    fn read_table_inputs(&self, inputs: &[Vec<Entity<InputState>>], cx: &App) -> Vec<Vec<String>> {
        inputs
            .iter()
            .map(|row| {
                row.iter()
                    .map(|input| input.read(cx).value().to_string())
                    .collect()
            })
            .collect()
    }

    fn apply_table_edit(
        &mut self,
        mut table: MarkdownTable,
        rows: Vec<Vec<String>>,
        operation: TableOperation,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        table.set_cells(rows);
        match operation {
            TableOperation::None => {}
            TableOperation::AddRow => table.add_row(),
            TableOperation::AddColumn => table.add_column(),
            TableOperation::RemoveRow(index) => table.remove_row(index),
            TableOperation::MoveRow(index, upward) => table.move_row(index, upward),
            TableOperation::RemoveColumn(index) => table.remove_column(index),
            TableOperation::MoveColumn(index, left) => table.move_column(index, left),
            TableOperation::CycleAlignment(index) => table.cycle_alignment(index),
        }
        let replacement = emit_table(&table);
        let range = table.start..table.end;
        let Some(document) = self.active_document() else {
            return;
        };
        document.update(cx, |document, cx| {
            document.replace_range(range, replacement, window, cx);
        });
        self.set_status(operation.status_message(), cx);
    }

    fn open_workspace_replace(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.root_dir.is_none() {
            self.set_status("Open a folder before replacing in the workspace", cx);
            return;
        }

        let query_input = cx.new(|cx| InputState::new(window, cx).placeholder("Find"));
        let replacement_input =
            cx.new(|cx| InputState::new(window, cx).placeholder("Replace with"));
        let case_sensitive = Rc::new(Cell::new(false));
        let owner = cx.weak_entity();
        let focus_on_mount = Rc::new(Cell::new(true));

        window.open_dialog(cx, move |dialog, _, _| {
            let query_input = query_input.clone();
            let replacement_input = replacement_input.clone();
            let case_sensitive = case_sensitive.clone();
            let owner = owner.clone();
            let focus_on_mount = focus_on_mount.clone();
            dialog
                .title("Replace in workspace")
                .w(px(560.))
                .content(move |content, window, cx| {
                    if focus_on_mount.replace(false) {
                        let query_input = query_input.clone();
                        window.defer(cx, move |window, cx| {
                            query_input.read(cx).focus_handle(cx).focus(window, cx);
                        });
                    }
                    let replace_owner = owner.clone();
                    let replace_query = query_input.clone();
                    let replace_replacement = replacement_input.clone();
                    let replace_case_sensitive = case_sensitive.clone();
                    content.child(
                        v_flex()
                            .w_full()
                            .gap_3()
                            .p_4()
                            .child(Input::new(&query_input).w_full())
                            .child(Input::new(&replacement_input).w_full())
                            .child(
                                Checkbox::new("workspace-case-sensitive")
                                    .label("Case sensitive")
                                    .checked(case_sensitive.get())
                                    .on_click({
                                        let case_sensitive = case_sensitive.clone();
                                        move |checked, _, _| {
                                            case_sensitive.set(*checked);
                                        }
                                    }),
                            )
                            .child(
                                h_flex().w_full().justify_end().gap_2().child(
                                    Button::new("workspace-replace-all")
                                        .primary()
                                        .label("Replace all")
                                        .on_click(move |_, window, cx| {
                                            let query = replace_query.read(cx).value().to_string();
                                            let replacement =
                                                replace_replacement.read(cx).value().to_string();
                                            let sensitive = replace_case_sensitive.get();
                                            _ = replace_owner.update(cx, |this, cx| {
                                                this.replace_in_workspace(
                                                    query,
                                                    replacement,
                                                    sensitive,
                                                    window,
                                                    cx,
                                                );
                                            });
                                            window.close_dialog(cx);
                                        }),
                                ),
                            ),
                    )
                })
        });
    }

    fn replace_in_workspace(
        &mut self,
        query: String,
        replacement: String,
        case_sensitive: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(root) = self.root_dir.clone() else {
            self.set_status("Open a folder before replacing in the workspace", cx);
            return;
        };
        if query.is_empty() {
            self.set_status("Enter text to find before replacing", cx);
            return;
        }

        let dirty_paths = self
            .documents
            .iter()
            .filter_map(|document| {
                document.read_with(cx, |document, _| {
                    document
                        .is_dirty()
                        .then(|| {
                            document
                                .path
                                .clone()
                                .map(|path| path.canonicalize().unwrap_or(path))
                        })
                        .flatten()
                })
            })
            .collect::<std::collections::HashSet<_>>();
        let canonical_root = root.canonicalize().unwrap_or_else(|_| root.clone());
        let mut files_changed = 0usize;
        let mut replacements = 0usize;
        let mut skipped_dirty = 0usize;
        let mut errors = 0usize;

        for path in collect_files(&root, 1_000) {
            if std::fs::symlink_metadata(&path)
                .is_ok_and(|metadata| metadata.file_type().is_symlink())
            {
                continue;
            }
            let Ok(metadata) = std::fs::metadata(&path) else {
                continue;
            };
            let canonical_path = path.canonicalize().unwrap_or_else(|_| path.clone());
            if metadata.len() > 512_000
                || metadata.permissions().readonly()
                || dirty_paths.contains(&canonical_path)
            {
                skipped_dirty += usize::from(dirty_paths.contains(&canonical_path));
                continue;
            }
            if !canonical_path.starts_with(&canonical_root) {
                continue;
            }
            let Ok(content) = std::fs::read_to_string(&path) else {
                continue;
            };
            let result = crate::workspace::apply_replacements(
                &content,
                &query,
                &replacement,
                case_sensitive,
            );
            if result.count == 0 {
                continue;
            }
            match write_file_atomically(&path, &result.result) {
                Ok(()) => {
                    files_changed += 1;
                    replacements += result.count;
                }
                Err(_) => errors += 1,
            }
        }

        for document in self.documents.clone() {
            let should_reload = document.read_with(cx, |document, _| {
                !document.is_dirty() && document.externally_changed()
            });
            if should_reload {
                _ = document.update(cx, |document, cx| document.reload_from_disk(window, cx));
            }
        }

        let mut message = format!(
            "Replaced {replacements} occurrence{} in {files_changed} file{}",
            if replacements == 1 { "" } else { "s" },
            if files_changed == 1 { "" } else { "s" },
        );
        if skipped_dirty > 0 {
            message.push_str(&format!("; skipped {skipped_dirty} dirty file"));
        }
        if errors > 0 {
            message.push_str(&format!("; {errors} write error"));
        }
        self.set_status(message, cx);
    }

    fn check_links(&mut self, cx: &mut Context<Self>) {
        let Some(document) = self.active_document() else {
            self.set_status("Open a document before checking links", cx);
            return;
        };
        let (content, document_dir) = document.read_with(cx, |document, cx| {
            (
                document.value(cx),
                document
                    .path
                    .as_ref()
                    .and_then(|path| path.parent())
                    .map(std::path::Path::to_path_buf)
                    .unwrap_or_else(|| PathBuf::from(".")),
            )
        });
        let broken = crate::links::broken_links(&content, &document_dir, self.root_dir.as_deref());
        if broken.is_empty() {
            self.set_status("All document links resolve", cx);
        } else {
            let first = &broken[0];
            self.set_status(
                format!(
                    "{} broken link{}; first: '{}' on line {}",
                    broken.len(),
                    if broken.len() == 1 { "" } else { "s" },
                    first.target,
                    first.line
                ),
                cx,
            );
        }
    }

    fn open_daily_note(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(root) = self.root_dir.clone() else {
            self.set_status("Open a folder before using daily notes", cx);
            return;
        };
        let directory = root.join("daily");
        if let Err(error) = std::fs::create_dir_all(&directory) {
            self.set_status(format!("Could not create daily notes folder: {error}"), cx);
            return;
        }
        let date = chrono::Local::now().format("%Y-%m-%d");
        let path = directory.join(format!("{date}.md"));
        if !path.exists()
            && let Err(error) = std::fs::write(
                &path,
                format!("# {date}\n\n## Notes\n\n## Tasks\n\n- [ ] \n"),
            )
        {
            self.set_status(format!("Could not create daily note: {error}"), cx);
            return;
        }
        self.open_path(path, window, cx);
        self.set_status("Opened today's daily note", cx);
    }

    fn open_workspace_search(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.root_dir.is_none() {
            self.set_status("Open a folder before searching the workspace", cx);
            return;
        }
        self.search_results.clear();
        let command = self.workspace_search.clone();
        command.update(cx, |command, cx| {
            command.set_query("", window, cx);
        });
        let owner = cx.weak_entity();
        let focus_on_mount = Rc::new(Cell::new(true));
        window.open_dialog(cx, move |dialog, _, _| {
            let command = command.clone();
            let owner = owner.clone();
            let focus_on_mount = focus_on_mount.clone();
            dialog
                .close_button(false)
                .p_0()
                .content(move |content, window, cx| {
                    if focus_on_mount.replace(false) {
                        let command = command.clone();
                        window.defer(cx, move |window, cx| {
                            command.read(cx).focus_handle(cx).focus(window, cx);
                        });
                    }
                    let query_owner = owner.clone();
                    let confirm_owner = owner.clone();
                    let results = owner
                        .read_with(cx, |this, _| this.search_results.clone())
                        .unwrap_or_default();
                    content.child(
                        Command::new(&command)
                            .w(px(680.))
                            .bordered(false)
                            .rounded(cx.theme().radius_lg)
                            .placeholder("Search workspace content...")
                            .filterable(false)
                            .items(results.iter().map(|result| {
                                let name = result
                                    .path
                                    .file_name()
                                    .and_then(|name| name.to_str())
                                    .unwrap_or("file");
                                CommandItem::new()
                                    .label(format!("{}:{} — {}", name, result.line, result.text))
                                    .keywords([result.path.display().to_string()])
                                    .icon(IconName::Search)
                                    .action(Box::new(WorkspaceSearchPick))
                            }))
                            .on_query(move |query, _, cx| {
                                _ = query_owner.update(cx, |this, cx| {
                                    this.search_results = this
                                        .root_dir
                                        .as_ref()
                                        .map(|root| search_files(root, query, 100))
                                        .unwrap_or_default();
                                    cx.notify();
                                });
                            })
                            .on_confirm(move |index, window, cx| {
                                _ = confirm_owner.update(cx, |this, cx| {
                                    if let Some(result) =
                                        this.search_results.get(index.row).cloned()
                                    {
                                        this.open_path(result.path, window, cx);
                                        if let Some(document) = this.active_document() {
                                            document.update(cx, |document, cx| {
                                                document.reveal_offset(result.offset, window, cx);
                                            });
                                        }
                                    }
                                });
                                window.close_dialog(cx);
                            }),
                    )
                })
        });
    }

    fn toggle_reading(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.reading_mode = !self.reading_mode;
        if self.reading_mode
            && let Some(document) = self.active_document()
        {
            document.update(cx, |document, cx| document.show_preview(cx));
        }
        self.focus_handle.focus(window, cx);
        cx.notify();
    }

    fn open_quick_open(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let mut paths = self
            .root_dir
            .as_ref()
            .map(|root| collect_files(root, 500))
            .unwrap_or_default();
        paths.extend(
            self.documents
                .iter()
                .filter_map(|document| document.read(cx).path.clone()),
        );
        paths.sort();
        paths.dedup();
        if paths.is_empty() {
            self.set_status("Open a folder or file before using quick open", cx);
            return;
        }

        let command = self.quick_open.clone();
        command.update(cx, |command, cx| {
            command.set_query("", window, cx);
        });
        let owner = cx.weak_entity();
        let focus_on_mount = Rc::new(Cell::new(true));
        window.open_dialog(cx, move |dialog, _, _| {
            let command = command.clone();
            let owner = owner.clone();
            let focus_on_mount = focus_on_mount.clone();
            let paths = paths.clone();
            dialog
                .close_button(false)
                .p_0()
                .content(move |content, window, cx| {
                    if focus_on_mount.replace(false) {
                        let command = command.clone();
                        window.defer(cx, move |window, cx| {
                            command.read(cx).focus_handle(cx).focus(window, cx);
                        });
                    }
                    let confirm_owner = owner.clone();
                    let confirm_paths = paths.clone();
                    content.child(
                        Command::new(&command)
                            .w(px(620.))
                            .bordered(false)
                            .rounded(cx.theme().radius_lg)
                            .placeholder("Open a file...")
                            .highlight_matches(true)
                            .items(paths.iter().map(|path| {
                                let name = path
                                    .file_name()
                                    .and_then(|name| name.to_str())
                                    .unwrap_or("file");
                                CommandItem::new()
                                    .label(format!("{} — {}", name, path.display()))
                                    .keywords([path.display().to_string()])
                                    .icon(IconName::File)
                                    .action(Box::new(QuickOpenPick))
                            }))
                            .on_confirm(move |index, window, cx| {
                                if let Some(path) = confirm_paths.get(index.row).cloned() {
                                    _ = confirm_owner.update(cx, |this, cx| {
                                        this.open_path(path, window, cx);
                                    });
                                }
                                let focus_owner = confirm_owner.clone();
                                window.close_dialog(cx);
                                window.defer(cx, move |window, cx| {
                                    _ = focus_owner.update(cx, |this, cx| {
                                        this.focus_handle.focus(window, cx);
                                    });
                                });
                            }),
                    )
                })
        });
    }

    fn render_tab_bar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        TabBar::new("documents")
            .w_full()
            .folder()
            .selected_index(self.active)
            .on_click(cx.listener(|this, index: &usize, _, cx| {
                this.select_tab(*index, cx);
            }))
            .children(self.documents.iter().enumerate().map(|(index, document)| {
                let document_ref = document.read(cx);
                let title = document_ref.title();
                let dirty = document_ref.is_dirty();
                Tab::new()
                    .px_2()
                    .prefix(Icon::new(IconName::BookOpen))
                    .label(if dirty {
                        format!("• {title}")
                    } else {
                        title.to_string()
                    })
                    .selected(self.active == index)
            }))
            .suffix(
                Button::new("new-tab")
                    .ghost()
                    .xsmall()
                    .mx_1()
                    .icon(IconName::Plus)
                    .tooltip("New tab (Ctrl+N)")
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.new_tab(window, cx);
                    })),
            )
    }

    fn render_sidebar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let root_dir = self.root_dir.clone();
        let title = root_dir
            .as_ref()
            .and_then(|path| path.file_name())
            .and_then(|name| name.to_str())
            .unwrap_or("Explorer")
            .to_string();

        v_flex()
            .w(px(260.))
            .h_full()
            .border_r_1()
            .border_color(cx.theme().border)
            .bg(cx.theme().sidebar)
            .text_color(cx.theme().sidebar_foreground)
            .child(
                h_flex()
                    .h_9()
                    .px_3()
                    .items_center()
                    .justify_between()
                    .border_b_1()
                    .border_color(cx.theme().border)
                    .child(
                        div()
                            .text_sm()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(title),
                    )
                    .child(
                        Button::new("open-folder")
                            .ghost()
                            .xsmall()
                            .icon(IconName::FolderOpen)
                            .tooltip("Open folder")
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.open_folder_action(window, cx);
                            })),
                    ),
            )
            .child(if root_dir.is_some() {
                div()
                    .flex_1()
                    .overflow_hidden()
                    .child(self.render_file_tree(cx))
                    .into_any_element()
            } else {
                div()
                    .flex_1()
                    .p_3()
                    .text_sm()
                    .text_color(cx.theme().muted_foreground)
                    .child("Open a folder to browse files.")
                    .into_any_element()
            })
            .child(self.render_outline(cx))
    }

    fn render_file_tree(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let view = cx.entity();
        let root = self.root_dir.clone().unwrap_or_default();
        tree(
            &self.tree_state,
            move |index, entry, _selected, _window, cx| {
                view.update(cx, |_, cx| {
                    let item = entry.item();
                    let icon = if !entry.is_folder() {
                        IconName::File
                    } else if entry.is_expanded() {
                        IconName::FolderOpen
                    } else {
                        IconName::Folder
                    };

                    ListItem::new(index)
                        .w_full()
                        .rounded(cx.theme().radius)
                        .py_0p5()
                        .px_2()
                        .pl(px(16.) * entry.depth() + px(8.))
                        .child(h_flex().gap_2().child(icon).child(item.label.clone()))
                        .on_click(cx.listener({
                            let item = item.clone();
                            let root = root.clone();
                            move |this, _, window, cx| {
                                if item.is_folder() {
                                    return;
                                }
                                let path = resolve_tree_path(&root, item.id.as_str());
                                this.open_path(path, window, cx);
                            }
                        }))
                })
            },
        )
        .text_sm()
        .p_1()
        .h_full()
    }

    fn render_outline(&self, cx: &mut Context<Self>) -> AnyElement {
        let Some(document) = self.active_document() else {
            return div().into_any_element();
        };
        let headings = markdown_headings(&document.read(cx).value(cx));
        if headings.len() < 2 {
            return div().into_any_element();
        }
        v_flex()
            .w_full()
            .max_h(px(220.))
            .flex_none()
            .overflow_hidden()
            .border_t_1()
            .border_color(cx.theme().border)
            .child(
                div()
                    .px_3()
                    .py_2()
                    .text_xs()
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(cx.theme().muted_foreground)
                    .child("OUTLINE"),
            )
            .child(
                v_flex()
                    .flex_1()
                    .overflow_y_scrollbar()
                    .px_1()
                    .pb_1()
                    .children(headings.into_iter().map(|(level, text, offset)| {
                        let document = document.clone();
                        Button::new(("outline-heading", offset))
                            .ghost()
                            .xsmall()
                            .w_full()
                            .justify_start()
                            .pl(px(8. + (level.saturating_sub(1) as f32 * 12.)))
                            .label(text)
                            .on_click(cx.listener(move |_, _, window, cx| {
                                document.update(cx, |document, cx| {
                                    document.reveal_offset(offset, window, cx);
                                });
                            }))
                    })),
            )
            .into_any_element()
    }

    fn render_empty_state(&self, cx: &mut Context<Self>) -> impl IntoElement {
        v_flex()
            .size_full()
            .items_center()
            .justify_center()
            .gap_4()
            .child(
                div()
                    .text_xl()
                    .font_weight(FontWeight::SEMIBOLD)
                    .child("Open a document"),
            )
            .child(
                div()
                    .text_sm()
                    .text_color(cx.theme().muted_foreground)
                    .child("Markdown, text, code, CSV, and images open in quiet native tabs."),
            )
            .child(
                h_flex()
                    .gap_2()
                    .child(
                        Button::new("empty-open")
                            .primary()
                            .icon(IconName::File)
                            .label("Open file")
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.open_file_action(window, cx);
                            })),
                    )
                    .child(
                        Button::new("empty-new")
                            .outline()
                            .icon(IconName::Plus)
                            .label("New document")
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.new_tab(window, cx);
                            })),
                    ),
            )
    }

    fn render_status_message(&self, cx: &mut Context<Self>) -> impl IntoElement {
        h_flex()
            .w_full()
            .h_6()
            .px_2()
            .items_center()
            .justify_between()
            .border_t_1()
            .border_color(cx.theme().border)
            .bg(cx.theme().title_bar)
            .child(
                div()
                    .text_xs()
                    .text_color(cx.theme().muted_foreground)
                    .child(
                        self.status_message
                            .clone()
                            .unwrap_or_else(|| "Ready".into()),
                    ),
            )
            .child(
                div()
                    .text_xs()
                    .text_color(cx.theme().muted_foreground)
                    .child("Ctrl+O open · Ctrl+S save · Ctrl+E edit/preview"),
            )
    }
}

fn table_operation_button(
    id: impl Into<ElementId>,
    label: &'static str,
    owner: WeakEntity<Mdpeek>,
    table: MarkdownTable,
    inputs: Vec<Vec<Entity<InputState>>>,
    operation: TableOperation,
) -> Button {
    Button::new(id)
        .ghost()
        .xsmall()
        .label(label)
        .on_click(move |_, window, cx| {
            perform_table_operation(
                owner.clone(),
                table.clone(),
                inputs.clone(),
                operation,
                window,
                cx,
            );
        })
}

fn perform_table_operation(
    owner: WeakEntity<Mdpeek>,
    table: MarkdownTable,
    inputs: Vec<Vec<Entity<InputState>>>,
    operation: TableOperation,
    window: &mut Window,
    cx: &mut App,
) {
    let reopen = operation.reopens_editor();
    let reopen_owner = owner.clone();
    _ = owner.update(cx, |this, cx| {
        let rows = this.read_table_inputs(&inputs, cx);
        this.apply_table_edit(table, rows, operation, window, cx);
    });
    window.close_dialog(cx);
    if reopen {
        window.defer(cx, move |window, cx| {
            _ = reopen_owner.update(cx, |this, cx| {
                this.open_table_editor(window, cx);
            });
        });
    }
}

fn write_file_atomically(path: &StdPath, contents: &str) -> std::io::Result<()> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("document");
    let parent = path.parent().unwrap_or_else(|| StdPath::new("."));
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
                file.write_all(contents.as_bytes())?;
                file.sync_all()?;
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

impl Focusable for Mdpeek {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl Render for Mdpeek {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let active_document = self.active_document();
        v_flex()
            .id("mdpeek-root")
            .key_context("Mdpeek")
            .track_focus(&self.focus_handle)
            .size_full()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .on_action(cx.listener(|this, _: &NewTab, window, cx| {
                this.new_tab(window, cx);
            }))
            .on_action(cx.listener(|this, _: &OpenFile, window, cx| {
                this.open_file_action(window, cx);
            }))
            .on_action(cx.listener(|this, _: &NavigateBack, window, cx| {
                this.navigate_history(true, window, cx);
            }))
            .on_action(cx.listener(|this, _: &NavigateForward, window, cx| {
                this.navigate_history(false, window, cx);
            }))
            .on_action(cx.listener(|this, _: &ZoomIn, _, cx| {
                this.zoom_active(ZoomOperation::In, cx);
            }))
            .on_action(cx.listener(|this, _: &ZoomOut, _, cx| {
                this.zoom_active(ZoomOperation::Out, cx);
            }))
            .on_action(cx.listener(|this, _: &ZoomReset, _, cx| {
                this.zoom_active(ZoomOperation::Reset, cx);
            }))
            .on_action(cx.listener(|this, _: &OpenSettings, window, cx| {
                this.open_settings(window, cx);
            }))
            .on_action(cx.listener(|this, _: &OpenFolder, window, cx| {
                this.open_folder_action(window, cx);
            }))
            .on_action(cx.listener(|this, _: &QuickOpen, window, cx| {
                this.open_quick_open(window, cx);
            }))
            .on_action(cx.listener(|this, _: &WorkspaceSearch, window, cx| {
                this.open_workspace_search(window, cx);
            }))
            .on_action(cx.listener(|this, _: &WorkspaceReplace, window, cx| {
                this.open_workspace_replace(window, cx);
            }))
            .on_action(cx.listener(|this, _: &GoToLine, window, cx| {
                this.open_go_to_line(window, cx);
            }))
            .on_action(cx.listener(|this, _: &DuplicateLines, window, cx| {
                this.apply_line_operation(EditorLineOperation::Duplicate, window, cx);
            }))
            .on_action(cx.listener(|this, _: &MoveLinesUp, window, cx| {
                this.apply_line_operation(EditorLineOperation::MoveUp, window, cx);
            }))
            .on_action(cx.listener(|this, _: &MoveLinesDown, window, cx| {
                this.apply_line_operation(EditorLineOperation::MoveDown, window, cx);
            }))
            .on_action(cx.listener(|this, _: &JoinLines, window, cx| {
                this.apply_line_operation(EditorLineOperation::Join, window, cx);
            }))
            .on_action(cx.listener(|this, _: &ItalicSelection, window, cx| {
                this.apply_markdown_format(
                    crate::editor_format::FormatOperation::Italic,
                    window,
                    cx,
                );
            }))
            .on_action(cx.listener(|this, _: &InlineCodeSelection, window, cx| {
                this.apply_markdown_format(
                    crate::editor_format::FormatOperation::InlineCode,
                    window,
                    cx,
                );
            }))
            .on_action(cx.listener(|this, _: &LinkSelection, window, cx| {
                this.apply_markdown_format(crate::editor_format::FormatOperation::Link, window, cx);
            }))
            .on_action(cx.listener(|this, _: &StrikethroughSelection, window, cx| {
                this.apply_markdown_format(
                    crate::editor_format::FormatOperation::Strikethrough,
                    window,
                    cx,
                );
            }))
            .on_action(cx.listener(|this, _: &QuoteSelection, window, cx| {
                this.apply_markdown_format(
                    crate::editor_format::FormatOperation::Quote,
                    window,
                    cx,
                );
            }))
            .on_action(cx.listener(|this, _: &SortLinesAscending, window, cx| {
                this.apply_text_transform(
                    crate::text_transform::TransformOperation::SortAscending,
                    window,
                    cx,
                );
            }))
            .on_action(cx.listener(|this, _: &SortLinesDescending, window, cx| {
                this.apply_text_transform(
                    crate::text_transform::TransformOperation::SortDescending,
                    window,
                    cx,
                );
            }))
            .on_action(cx.listener(|this, _: &UppercaseSelection, window, cx| {
                this.apply_text_transform(
                    crate::text_transform::TransformOperation::Uppercase,
                    window,
                    cx,
                );
            }))
            .on_action(cx.listener(|this, _: &LowercaseSelection, window, cx| {
                this.apply_text_transform(
                    crate::text_transform::TransformOperation::Lowercase,
                    window,
                    cx,
                );
            }))
            .on_action(cx.listener(|this, _: &TitleCaseSelection, window, cx| {
                this.apply_text_transform(
                    crate::text_transform::TransformOperation::TitleCase,
                    window,
                    cx,
                );
            }))
            .on_action(cx.listener(|this, _: &ToggleCaseSelection, window, cx| {
                this.apply_text_transform(
                    crate::text_transform::TransformOperation::ToggleCase,
                    window,
                    cx,
                );
            }))
            .on_action(cx.listener(|this, _: &InsertToc, window, cx| {
                this.apply_text_transform(
                    crate::text_transform::TransformOperation::InsertToc,
                    window,
                    cx,
                );
            }))
            .on_action(cx.listener(|this, _: &InsertDate, window, cx| {
                this.apply_text_transform(
                    crate::text_transform::TransformOperation::InsertDate,
                    window,
                    cx,
                );
            }))
            .on_action(cx.listener(|this, _: &DailyNote, window, cx| {
                this.open_daily_note(window, cx);
            }))
            .on_action(cx.listener(|this, _: &CheckLinks, _, cx| {
                this.check_links(cx);
            }))
            .on_action(cx.listener(|this, _: &CommandPalette, window, cx| {
                this.open_command_palette(window, cx);
            }))
            .on_action(cx.listener(|this, _: &SnippetPicker, window, cx| {
                this.open_snippet_picker(window, cx);
            }))
            .on_action(cx.listener(|this, _: &EditTable, window, cx| {
                this.open_table_editor(window, cx);
            }))
            .on_action(cx.listener(|this, _: &ToggleReading, window, cx| {
                this.toggle_reading(window, cx);
            }))
            .on_action(cx.listener(|this, _: &Save, window, cx| {
                this.save_active(window, cx);
            }))
            .on_action(cx.listener(|this, _: &SaveAs, window, cx| {
                this.save_active_as(window, cx);
            }))
            .on_action(cx.listener(|this, _: &CloseTab, _, cx| {
                this.close_active_tab(cx);
            }))
            .on_action(cx.listener(|this, _: &CloseOtherTabs, _, cx| {
                this.close_other_tabs(cx);
            }))
            .on_action(cx.listener(|this, _: &CloseTabsToRight, _, cx| {
                this.close_tabs_to_right(cx);
            }))
            .on_action(cx.listener(|this, _: &CloseAllTabs, _, cx| {
                this.close_all_tabs(cx);
            }))
            .on_action(cx.listener(|this, _: &ToggleEdit, window, cx| {
                this.toggle_edit(window, cx);
            }))
            .on_action(cx.listener(|this, _: &ToggleSidebar, window, cx| {
                this.toggle_sidebar_or_bold(window, cx);
            }))
            .on_action(cx.listener(|this, _: &ToggleTheme, _, cx| {
                this.toggle_theme(cx);
            }))
            .on_action(cx.listener(|this, _: &ReloadFile, window, cx| {
                this.reload_active(window, cx);
            }))
            .on_action(cx.listener(|this, _: &ReopenClosedTab, window, cx| {
                this.reopen_closed_tab(window, cx);
            }))
            .on_action(cx.listener(|this, _: &ExportHtml, window, cx| {
                this.export_active_html(window, cx);
            }))
            .on_action(cx.listener(|this, _: &CopyHtml, _, cx| {
                this.copy_active_html(cx);
            }))
            .on_action(cx.listener(|this, _: &CopyPlainText, _, cx| {
                this.copy_active_plain_text(cx);
            }))
            .on_action(cx.listener(|this, _: &OpenInBrowser, _, cx| {
                this.open_active_in_browser(cx);
            }))
            .on_action(cx.listener(|this, _: &ExportText, window, cx| {
                this.export_active_text(window, cx);
            }))
            .on_action(cx.listener(|this, _: &ExportPdf, window, cx| {
                this.export_active_pdf(window, cx);
            }))
            .on_action(cx.listener(|this, _: &NextTab, _, cx| {
                this.step_tab(1, cx);
            }))
            .on_action(cx.listener(|this, _: &PreviousTab, _, cx| {
                this.step_tab(-1, cx);
            }))
            .on_action(cx.listener(|this, _: &Quit, _, cx| {
                this.persist(cx);
                cx.quit();
            }))
            .child(gpui_kit::base::TextSelectionLayer)
            .when(!self.documents.is_empty() && !self.reading_mode, |this| {
                this.child(self.render_tab_bar(cx))
            })
            .child(
                h_flex()
                    .flex_1()
                    .overflow_hidden()
                    .when(self.sidebar_visible && !self.reading_mode, |this| {
                        this.child(self.render_sidebar(cx))
                    })
                    .child(div().flex_1().h_full().overflow_hidden().map(|this| {
                        if let Some(document) = active_document {
                            this.child(document).into_any_element()
                        } else {
                            this.child(self.render_empty_state(cx)).into_any_element()
                        }
                    })),
            )
            .when(!self.reading_mode, |this| {
                this.child(self.render_status_message(cx))
            })
    }
}

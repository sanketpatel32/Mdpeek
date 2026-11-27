use std::{cell::Cell, path::PathBuf, rc::Rc};

use gpui_kit::component::{
    ActiveTheme as _, Icon, IconName, Selectable as _, Sizable as _, Theme, ThemeMode,
    WindowExt as _,
    button::{Button, ButtonVariants as _},
    checkbox::Checkbox,
    command::{Command, CommandItem, CommandState},
    h_flex,
    input::{Input, InputState},
    list::ListItem,
    scroll::ScrollableElement,
    tab::{Tab, TabBar},
    tree::{TreeState, tree},
    v_flex,
};
use gpui_kit::{prelude::FluentBuilder as _, *};

use crate::document::{DocumentView, read_document};
use crate::export::{markdown_to_html_document, markdown_to_pdf, markdown_to_plain_text};
use crate::settings::{SessionState, load_session, save_session};
use crate::workspace::{
    SearchMatch, build_file_items, collect_files, resolve_tree_path, search_files,
};

actions!(
    mdpeek,
    [
        NewTab,
        OpenFile,
        QuickOpen,
        QuickOpenPick,
        CommandPalette,
        CommandPalettePick,
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
        ToggleEdit,
        ToggleSidebar,
        ToggleTheme,
        ReloadFile,
        ReopenClosedTab,
        ExportHtml,
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
    search_results: Vec<SearchMatch>,
    reading_mode: bool,
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

fn command_palette_entries() -> Vec<(&'static str, &'static str)> {
    vec![
        ("New document", "Ctrl+N"),
        ("Open file", "Ctrl+O"),
        ("Open folder", "Ctrl+Shift+E"),
        ("Quick open", "Ctrl+P"),
        ("Search workspace", "Ctrl+Shift+F"),
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
        ("Export plain text", "Ctrl+Shift+T"),
        ("Export PDF", "Ctrl+Shift+P"),
        ("Close tab", "Ctrl+W"),
        ("Quit", "Ctrl+Q"),
    ]
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
            search_results: Vec::new(),
            reading_mode: false,
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
        document.update(cx, |document, _| document.set_owner(owner));
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
            cx.notify();
            return;
        }

        match read_document(&path) {
            Ok((content, kind)) => {
                let owner = cx.weak_entity();
                let document =
                    cx.new(|cx| DocumentView::new(Some(path.clone()), content, kind, window, cx));
                document.update(cx, |document, _| document.set_owner(owner));
                let is_image = kind == crate::document::DocumentKind::Image;
                self.documents.push(document);
                self.active = self.documents.len() - 1;
                if is_image {
                    self.focus_handle.focus(window, cx);
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
                                _ = confirm_owner.update(cx, |this, cx| {
                                    this.run_command_palette_row(index.row, window, cx);
                                });
                                window.close_dialog(cx);
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
            5 => self.open_workspace_replace(window, cx),
            6 => self.open_daily_note(window, cx),
            7 => self.check_links(cx),
            8 => self.save_active(window, cx),
            9 => self.save_active_as(window, cx),
            10 => self.reload_active(window, cx),
            11 => self.reopen_closed_tab(window, cx),
            12 => self.toggle_edit(window, cx),
            13 => {
                self.sidebar_visible = !self.sidebar_visible;
                cx.notify();
            }
            14 => self.toggle_reading(window, cx),
            15 => self.toggle_theme(cx),
            16 => self.export_active_html(window, cx),
            17 => self.export_active_text(window, cx),
            18 => self.export_active_pdf(window, cx),
            19 => self.close_active_tab(cx),
            20 => {
                self.persist(cx);
                cx.quit();
            }
            _ => {}
        }
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
                    document.is_dirty().then(|| document.path.clone()).flatten()
                })
            })
            .collect::<std::collections::HashSet<_>>();
        let canonical_root = root.canonicalize().unwrap_or_else(|_| root.clone());
        let mut files_changed = 0usize;
        let mut replacements = 0usize;
        let mut skipped_dirty = 0usize;
        let mut errors = 0usize;

        for path in collect_files(&root, 1_000) {
            let Ok(metadata) = std::fs::metadata(&path) else {
                continue;
            };
            if metadata.len() > 512_000 || dirty_paths.contains(&path) {
                skipped_dirty += usize::from(dirty_paths.contains(&path));
                continue;
            }
            if path
                .canonicalize()
                .is_ok_and(|canonical| !canonical.starts_with(&canonical_root))
            {
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
            match std::fs::write(&path, result.result) {
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
            .on_action(cx.listener(|this, _: &DailyNote, window, cx| {
                this.open_daily_note(window, cx);
            }))
            .on_action(cx.listener(|this, _: &CheckLinks, _, cx| {
                this.check_links(cx);
            }))
            .on_action(cx.listener(|this, _: &CommandPalette, window, cx| {
                this.open_command_palette(window, cx);
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
            .on_action(cx.listener(|this, _: &ToggleEdit, window, cx| {
                this.toggle_edit(window, cx);
            }))
            .on_action(cx.listener(|this, _: &ToggleSidebar, _, cx| {
                this.sidebar_visible = !this.sidebar_visible;
                cx.notify();
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

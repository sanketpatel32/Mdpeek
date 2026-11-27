use std::path::PathBuf;

use gpui_kit::component::{
    ActiveTheme as _, Icon, IconName, Selectable as _, Sizable as _, Theme, ThemeMode,
    button::{Button, ButtonVariants as _},
    h_flex,
    list::ListItem,
    tab::{Tab, TabBar},
    tree::{TreeState, tree},
    v_flex,
};
use gpui_kit::{prelude::FluentBuilder as _, *};

use crate::document::{DocumentView, read_document};
use crate::export::{markdown_to_html_document, markdown_to_plain_text};
use crate::workspace::{build_file_items, resolve_tree_path};

actions!(
    mdpeek,
    [
        NewTab,
        OpenFile,
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
    focus_handle: FocusHandle,
}

impl Mdpeek {
    pub fn new(_window: &mut Window, cx: &mut Context<Self>) -> Self {
        Self {
            documents: Vec::new(),
            active: 0,
            closed_paths: Vec::new(),
            sidebar_visible: true,
            root_dir: None,
            tree_state: cx.new(|cx| TreeState::new(cx)),
            status_message: None,
            focus_handle: cx.focus_handle(),
        }
    }

    pub fn view(window: &mut Window, cx: &mut App) -> Entity<Self> {
        cx.new(|cx| Self::new(window, cx))
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
        let document = cx.new(|cx| DocumentView::untitled(window, cx));
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

    fn open_path(&mut self, path: PathBuf, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(index) = self.documents.iter().position(|document| {
            document
                .read(cx)
                .path
                .as_ref()
                .is_some_and(|open| *open == path)
        }) {
            self.active = index;
            cx.notify();
            return;
        }

        match read_document(&path) {
            Ok((content, kind)) => {
                let document =
                    cx.new(|cx| DocumentView::new(Some(path.clone()), content, kind, window, cx));
                self.documents.push(document);
                self.active = self.documents.len() - 1;
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

    fn toggle_edit(&mut self, cx: &mut Context<Self>) {
        if let Some(document) = self.active_document() {
            document.update(cx, |document, cx| document.toggle_edit(cx));
        }
    }

    fn toggle_theme(&mut self, cx: &mut Context<Self>) {
        let next = if cx.theme().is_dark() {
            ThemeMode::Light
        } else {
            ThemeMode::Dark
        };
        Theme::change(next, None, cx);
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
                self.render_file_tree(cx).into_any_element()
            } else {
                div()
                    .p_3()
                    .text_sm()
                    .text_color(cx.theme().muted_foreground)
                    .child("Open a folder to browse files.")
                    .into_any_element()
            })
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
                            move |_, _, window, cx| {
                                if item.is_folder() {
                                    return;
                                }
                                let path = resolve_tree_path(&root, item.id.as_str());
                                cx.entity().update(cx, |this, cx| {
                                    this.open_path(path, window, cx);
                                });
                            }
                        }))
                })
            },
        )
        .text_sm()
        .p_1()
        .h_full()
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
            .on_action(cx.listener(|this, _: &Save, window, cx| {
                this.save_active(window, cx);
            }))
            .on_action(cx.listener(|this, _: &SaveAs, window, cx| {
                this.save_active_as(window, cx);
            }))
            .on_action(cx.listener(|this, _: &CloseTab, _, cx| {
                this.close_active_tab(cx);
            }))
            .on_action(cx.listener(|this, _: &ToggleEdit, _, cx| {
                this.toggle_edit(cx);
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
            .on_action(cx.listener(|this, _: &NextTab, _, cx| {
                this.step_tab(1, cx);
            }))
            .on_action(cx.listener(|this, _: &PreviousTab, _, cx| {
                this.step_tab(-1, cx);
            }))
            .on_action(|_: &Quit, _, cx| cx.quit())
            .when(!self.documents.is_empty(), |this| {
                this.child(self.render_tab_bar(cx))
            })
            .child(
                h_flex()
                    .flex_1()
                    .overflow_hidden()
                    .when(self.sidebar_visible, |this| {
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
            .child(self.render_status_message(cx))
    }
}

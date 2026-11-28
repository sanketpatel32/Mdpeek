mod annotation;
mod app;
mod completion;
mod csv;
mod document;
mod editor_format;
mod editor_ops;
mod export;
mod links;
mod math;
mod mermaid;
mod settings;
mod table;
mod text_transform;
mod workspace;

use app::{
    CheckLinks, CloseTab, CommandPalette, DailyNote, DuplicateLines, EditTable, ExportHtml,
    ExportPdf, ExportText, GoToLine, InlineCodeSelection, ItalicSelection, JoinLines,
    LinkSelection, Mdpeek, MoveLinesDown, MoveLinesUp, NavigateBack, NavigateForward, NewTab,
    NextTab, OpenFile, OpenFolder, OpenSettings, PreviousTab, QuickOpen, Quit, QuoteSelection,
    ReloadFile, ReopenClosedTab, Save, SaveAs, SnippetPicker, StrikethroughSelection, ToggleEdit,
    ToggleReading, ToggleSidebar, ToggleTheme, WorkspaceReplace, WorkspaceSearch, ZoomIn, ZoomOut,
    ZoomReset,
};
use gpui_kit::*;

fn main() {
    gpui_kit::application()
        .with_assets(gpui_kit::assets::AllAssets)
        .run(|cx| {
            gpui_kit::init(cx);
            cx.bind_keys([
                KeyBinding::new("ctrl-n", NewTab, Some("Mdpeek")),
                KeyBinding::new("ctrl-o", OpenFile, Some("Mdpeek")),
                KeyBinding::new("alt-left", NavigateBack, Some("Mdpeek")),
                KeyBinding::new("alt-right", NavigateForward, Some("Mdpeek")),
                KeyBinding::new("ctrl-=", ZoomIn, Some("Mdpeek")),
                KeyBinding::new("ctrl--", ZoomOut, Some("Mdpeek")),
                KeyBinding::new("ctrl-0", ZoomReset, Some("Mdpeek")),
                KeyBinding::new("ctrl-,", OpenSettings, Some("Mdpeek")),
                KeyBinding::new("ctrl-p", QuickOpen, Some("Mdpeek")),
                KeyBinding::new("ctrl-shift-f", WorkspaceSearch, Some("Mdpeek")),
                KeyBinding::new("ctrl-shift-r", WorkspaceReplace, Some("Mdpeek")),
                KeyBinding::new("ctrl-shift-d", DailyNote, Some("Mdpeek")),
                KeyBinding::new("ctrl-shift-s", SnippetPicker, Some("Mdpeek")),
                KeyBinding::new("ctrl-alt-i", CheckLinks, Some("Mdpeek")),
                KeyBinding::new("ctrl-alt-m", EditTable, Some("Mdpeek")),
                KeyBinding::new("ctrl-g", GoToLine, Some("Mdpeek")),
                KeyBinding::new("ctrl-d", DuplicateLines, Some("Mdpeek")),
                KeyBinding::new("ctrl-i", ItalicSelection, Some("Mdpeek")),
                KeyBinding::new("ctrl-`", InlineCodeSelection, Some("Mdpeek")),
                KeyBinding::new("ctrl-k", LinkSelection, Some("Mdpeek")),
                KeyBinding::new("ctrl-shift-x", StrikethroughSelection, Some("Mdpeek")),
                KeyBinding::new("ctrl->", QuoteSelection, Some("Mdpeek")),
                KeyBinding::new("alt-up", MoveLinesUp, Some("Mdpeek")),
                KeyBinding::new("alt-down", MoveLinesDown, Some("Mdpeek")),
                KeyBinding::new("ctrl-j", JoinLines, Some("Mdpeek")),
                KeyBinding::new("ctrl-alt-p", CommandPalette, Some("Mdpeek")),
                KeyBinding::new("f11", ToggleReading, Some("Mdpeek")),
                KeyBinding::new("ctrl-shift-e", OpenFolder, Some("Mdpeek")),
                KeyBinding::new("ctrl-s", Save, Some("Mdpeek")),
                KeyBinding::new("ctrl-alt-s", SaveAs, Some("Mdpeek")),
                KeyBinding::new("ctrl-w", CloseTab, Some("Mdpeek")),
                KeyBinding::new("ctrl-e", ToggleEdit, Some("Mdpeek")),
                KeyBinding::new("ctrl-b", ToggleSidebar, Some("Mdpeek")),
                KeyBinding::new("ctrl-shift-l", ToggleTheme, Some("Mdpeek")),
                KeyBinding::new("ctrl-r", ReloadFile, Some("Mdpeek")),
                KeyBinding::new("ctrl-alt-t", ReopenClosedTab, Some("Mdpeek")),
                KeyBinding::new("ctrl-shift-h", ExportHtml, Some("Mdpeek")),
                KeyBinding::new("ctrl-shift-t", ExportText, Some("Mdpeek")),
                KeyBinding::new("ctrl-shift-p", ExportPdf, Some("Mdpeek")),
                KeyBinding::new("ctrl-tab", NextTab, Some("Mdpeek")),
                KeyBinding::new("ctrl-shift-tab", PreviousTab, Some("Mdpeek")),
                KeyBinding::new("ctrl-q", Quit, Some("Mdpeek")),
                KeyBinding::new("alt-f4", Quit, Some("Mdpeek")),
            ]);

            let current_dir = std::env::current_dir().ok();
            let initial_paths = std::env::args_os()
                .skip(1)
                .map(std::path::PathBuf::from)
                .filter(|path| path.exists())
                .map(|path| {
                    if path.is_absolute() {
                        path
                    } else if let Some(current_dir) = &current_dir {
                        current_dir.join(path)
                    } else {
                        path
                    }
                })
                .collect::<Vec<_>>();
            let mut options = WindowOptions {
                window_min_size: Some(size(px(300.), px(260.))),
                ..gpui_kit::component::TitleBar::window_options()
            };
            if let Some(titlebar) = options.titlebar.as_mut() {
                titlebar.title = Some("Mdpeek".into());
            }
            gpui_kit::open_window(options, cx, |window, cx| {
                Mdpeek::view(window, cx, &initial_paths)
            })
            .expect("failed to open mdpeek window");
        });
}

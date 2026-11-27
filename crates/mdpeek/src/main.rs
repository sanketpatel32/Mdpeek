mod annotation;
mod app;
mod completion;
mod csv;
mod document;
mod export;
mod links;
mod math;
mod settings;
mod table;
mod workspace;

use app::{
    CheckLinks, CloseTab, CommandPalette, DailyNote, EditTable, ExportHtml, ExportPdf, ExportText,
    Mdpeek, NewTab, NextTab, OpenFile, OpenFolder, PreviousTab, QuickOpen, Quit, ReloadFile,
    ReopenClosedTab, Save, SaveAs, SnippetPicker, ToggleEdit, ToggleReading, ToggleSidebar,
    ToggleTheme, WorkspaceReplace, WorkspaceSearch,
};
use gpui_kit::*;

fn main() {
    gpui_kit::application()
        .with_assets(gpui_kit::assets::Assets)
        .run(|cx| {
            gpui_kit::init(cx);
            cx.bind_keys([
                KeyBinding::new("ctrl-n", NewTab, Some("Mdpeek")),
                KeyBinding::new("ctrl-o", OpenFile, Some("Mdpeek")),
                KeyBinding::new("ctrl-p", QuickOpen, Some("Mdpeek")),
                KeyBinding::new("ctrl-shift-f", WorkspaceSearch, Some("Mdpeek")),
                KeyBinding::new("ctrl-shift-r", WorkspaceReplace, Some("Mdpeek")),
                KeyBinding::new("ctrl-shift-d", DailyNote, Some("Mdpeek")),
                KeyBinding::new("ctrl-shift-s", SnippetPicker, Some("Mdpeek")),
                KeyBinding::new("ctrl-alt-i", CheckLinks, Some("Mdpeek")),
                KeyBinding::new("ctrl-alt-m", EditTable, Some("Mdpeek")),
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

            let initial_paths = std::env::args_os()
                .skip(1)
                .map(std::path::PathBuf::from)
                .filter(|path| path.exists())
                .collect::<Vec<_>>();
            gpui_kit::open_window(WindowOptions::default(), cx, |window, cx| {
                Mdpeek::view(window, cx, &initial_paths)
            })
            .expect("failed to open mdpeek window");
        });
}

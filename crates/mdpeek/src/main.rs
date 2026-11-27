mod app;
mod document;
mod export;
mod workspace;

use app::{
    CloseTab, ExportHtml, ExportText, Mdpeek, NewTab, NextTab, OpenFile, OpenFolder, PreviousTab,
    Quit, ReloadFile, ReopenClosedTab, Save, SaveAs, ToggleEdit, ToggleSidebar, ToggleTheme,
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
                KeyBinding::new("ctrl-tab", NextTab, Some("Mdpeek")),
                KeyBinding::new("ctrl-shift-tab", PreviousTab, Some("Mdpeek")),
                KeyBinding::new("ctrl-q", Quit, Some("Mdpeek")),
                KeyBinding::new("alt-f4", Quit, Some("Mdpeek")),
            ]);

            gpui_kit::open_window(WindowOptions::default(), cx, |window, cx| {
                Mdpeek::view(window, cx)
            })
            .expect("failed to open mdpeek window");
        });
}

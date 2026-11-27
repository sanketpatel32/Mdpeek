use gpui_kit::component::label::Label;
use gpui_kit::component::*;
use gpui_kit::*;

struct Mdpeek;

impl Render for Mdpeek {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .v_flex()
            .size_full()
            .items_center()
            .justify_center()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .child(Label::new("mdpeek GPUI rebuild"))
    }
}

fn main() {
    gpui_kit::application()
        .with_assets(gpui_kit::assets::Assets)
        .run(|cx| {
            gpui_kit::init(cx);
            gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| cx.new(|_| Mdpeek))
                .expect("failed to open mdpeek window");
        });
}

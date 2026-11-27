use gpui_kit::component::{
    ActiveTheme as _,
    text::{
        InlineElement, InlineRenderContext, MarkdownNode, MarkdownParseContext, MarkdownPlugin,
        markdown_ast,
    },
};
use gpui_kit::*;

#[derive(Clone, Debug)]
struct MathNode {
    source: String,
}

#[derive(Clone)]
pub struct MathPlugin;

#[derive(Clone)]
pub struct InlineMathPlugin;

fn math_node(source: String, inline: bool, markdown: impl Into<String>) -> MarkdownNode {
    MarkdownNode::new(
        if inline { "inline-math" } else { "math" },
        MathNode {
            source: source.clone(),
        },
    )
    .text(prettify_math_source(&source))
    .accessibility_label(format!("Formula: {}", prettify_math_source(&source)))
    .markdown(markdown.into())
}

fn block_math_source(source: &str) -> Option<&str> {
    let source = source.trim();
    let body = source.strip_prefix("$$")?.strip_suffix("$$")?.trim();
    (!body.is_empty()).then_some(body)
}

impl MarkdownPlugin for MathPlugin {
    fn is_block(&self) -> bool {
        true
    }

    fn name(&self) -> &str {
        "math"
    }

    fn parse(
        &self,
        node: &markdown_ast::Node,
        cx: &MarkdownParseContext<'_>,
    ) -> Option<MarkdownNode> {
        if let markdown_ast::Node::Math(math) = node {
            return Some(math_node(
                math.value.clone(),
                false,
                cx.node_source(node)
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("$$\n{}\n$$", math.value)),
            ));
        }

        let markdown_ast::Node::Paragraph(_) = node else {
            return None;
        };
        let source = cx.node_source(node)?;
        block_math_source(source).map(|math| math_node(math.to_string(), false, source))
    }

    fn render(&self, node: &MarkdownNode, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let math = node.data::<MathNode>().expect("math markdown node data");
        let font_size = f32::from(window.text_style().font_size.to_pixels(window.rem_size()));
        div()
            .w_full()
            .flex()
            .justify_center()
            .py_2()
            .child(render_math_text(
                &math.source,
                false,
                font_size,
                cx.theme().foreground,
            ))
    }
}

impl MarkdownPlugin for InlineMathPlugin {
    fn name(&self) -> &str {
        "inline-math"
    }

    fn parse(
        &self,
        node: &markdown_ast::Node,
        context: &MarkdownParseContext<'_>,
    ) -> Option<MarkdownNode> {
        let markdown_ast::Node::InlineMath(math) = node else {
            return None;
        };
        Some(math_node(
            math.value.clone(),
            true,
            context
                .node_source(node)
                .map(str::to_string)
                .unwrap_or_else(|| format!("${}$", math.value)),
        ))
    }

    fn render_inline(
        &self,
        node: &MarkdownNode,
        context: &InlineRenderContext,
        _window: &mut Window,
        _cx: &mut App,
    ) -> Option<InlineElement> {
        let math = node.data::<MathNode>()?;
        let font_size = f32::from(context.font_size());
        Some(InlineElement::new(render_math_text(
            &math.source,
            true,
            font_size,
            context.text_style().color,
        )))
    }
}

fn render_math_text(source: &str, inline: bool, font_size: f32, color: Hsla) -> AnyElement {
    div()
        .flex_none()
        .line_height(relative(if inline { 1.0 } else { 1.2 }))
        .text_size(px(if inline {
            font_size.max(10.0)
        } else {
            (font_size * 1.15).max(12.0)
        }))
        .text_color(color)
        .italic()
        .child(prettify_math_source(source))
        .into_any_element()
}

fn prettify_math_source(source: &str) -> String {
    let mut out = source.split_whitespace().collect::<Vec<_>>().join(" ");
    for (from, to) in [
        (r"\alpha", "α"),
        (r"\beta", "β"),
        (r"\gamma", "γ"),
        (r"\delta", "δ"),
        (r"\epsilon", "ε"),
        (r"\theta", "θ"),
        (r"\lambda", "λ"),
        (r"\mu", "μ"),
        (r"\pi", "π"),
        (r"\sigma", "σ"),
        (r"\phi", "φ"),
        (r"\omega", "ω"),
        (r"\sum", "∑"),
        (r"\prod", "∏"),
        (r"\sqrt", "√"),
        (r"\times", "×"),
        (r"\cdot", "⋅"),
        (r"\pm", "±"),
        (r"\leq", "≤"),
        (r"\geq", "≥"),
        (r"\neq", "≠"),
        (r"\approx", "≈"),
        (r"\infty", "∞"),
        (r"\rightarrow", "→"),
        (r"\leftarrow", "←"),
        (r"\left", ""),
        (r"\right", ""),
    ] {
        out = out.replace(from, to);
    }
    compact_math_scripts(&out)
}

fn compact_math_scripts(source: &str) -> String {
    let chars = source.chars().collect::<Vec<_>>();
    let mut out = String::new();
    let mut ix = 0;
    while ix < chars.len() {
        match chars[ix] {
            '^' | '_' => {
                let superscript = chars[ix] == '^';
                let (script, next_ix) = take_script(&chars, ix + 1);
                if script.is_empty() {
                    out.push(chars[ix]);
                    ix += 1;
                } else {
                    for ch in script.chars() {
                        out.push(script_char(ch, superscript));
                    }
                    ix = next_ix;
                }
            }
            ch => {
                out.push(ch);
                ix += 1;
            }
        }
    }
    out
}

fn take_script(chars: &[char], mut ix: usize) -> (String, usize) {
    if ix >= chars.len() {
        return (String::new(), ix);
    }
    if chars[ix] == '{' {
        let mut depth = 1;
        let start = ix + 1;
        ix += 1;
        while ix < chars.len() && depth > 0 {
            match chars[ix] {
                '{' => depth += 1,
                '}' => depth -= 1,
                _ => {}
            }
            ix += 1;
        }
        return (chars[start..ix.saturating_sub(1)].iter().collect(), ix);
    }
    (chars[ix].to_string(), ix + 1)
}

fn script_char(ch: char, superscript: bool) -> char {
    let table = if superscript {
        [
            ('0', '⁰'),
            ('1', '¹'),
            ('2', '²'),
            ('3', '³'),
            ('4', '⁴'),
            ('5', '⁵'),
            ('6', '⁶'),
            ('7', '⁷'),
            ('8', '⁸'),
            ('9', '⁹'),
            ('+', '⁺'),
            ('-', '⁻'),
            ('=', '⁼'),
            ('(', '⁽'),
            (')', '⁾'),
            ('n', 'ⁿ'),
            ('i', 'ⁱ'),
        ]
        .as_slice()
    } else {
        [
            ('0', '₀'),
            ('1', '₁'),
            ('2', '₂'),
            ('3', '₃'),
            ('4', '₄'),
            ('5', '₅'),
            ('6', '₆'),
            ('7', '₇'),
            ('8', '₈'),
            ('9', '₉'),
            ('+', '₊'),
            ('-', '₋'),
            ('=', '₌'),
            ('(', '₍'),
            (')', '₎'),
            ('a', 'ₐ'),
            ('e', 'ₑ'),
            ('o', 'ₒ'),
            ('x', 'ₓ'),
        ]
        .as_slice()
    };
    table
        .iter()
        .find_map(|(plain, script)| (*plain == ch).then_some(*script))
        .unwrap_or(ch)
}

use std::collections::HashMap;

use gpui_kit::component::{
    ActiveTheme as _,
    scroll::ScrollableElement,
    text::{MarkdownNode, MarkdownParseContext, MarkdownPlugin, markdown_ast},
    v_flex,
};
use gpui_kit::*;

#[derive(Clone, Debug, PartialEq, Eq)]
enum Direction {
    Vertical,
    Horizontal,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct MermaidNode {
    label: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MermaidGraph {
    nodes: Vec<MermaidNode>,
    edges: Vec<(usize, usize)>,
    direction: Direction,
}

#[derive(Clone)]
pub struct MermaidPlugin;

fn parse_endpoint(source: &str) -> Option<(String, String)> {
    let source = source.trim().trim_end_matches(';').trim();
    if source.is_empty() {
        return None;
    }
    let id_end = source
        .char_indices()
        .find_map(|(index, ch)| {
            (ch.is_whitespace() || matches!(ch, '[' | '(' | '{')).then_some(index)
        })
        .unwrap_or(source.len());
    let id = source[..id_end].trim();
    if id.is_empty()
        || !id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.'))
    {
        return None;
    }
    let remainder = source[id_end..].trim_start();
    let label = if let Some(rest) = remainder.strip_prefix('[') {
        rest.split(']').next().unwrap_or(id).trim()
    } else if let Some(rest) = remainder.strip_prefix("((") {
        rest.split("))").next().unwrap_or(id).trim()
    } else if let Some(rest) = remainder.strip_prefix('(') {
        rest.split(')').next().unwrap_or(id).trim()
    } else if let Some(rest) = remainder.strip_prefix('{') {
        rest.split('}').next().unwrap_or(id).trim()
    } else {
        id
    };
    Some((id.to_string(), label.to_string()))
}

pub fn parse_flowchart(source: &str) -> Option<MermaidGraph> {
    let mut lines = source
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with("%%"));
    let first = lines.next()?;
    if !(first.starts_with("flowchart") || first.starts_with("graph")) {
        return None;
    }
    let direction = if first
        .split_whitespace()
        .any(|part| part == "LR" || part == "RL")
    {
        Direction::Horizontal
    } else {
        Direction::Vertical
    };
    let mut ids = HashMap::<String, usize>::new();
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    for line in lines {
        if !line.contains("-->") {
            continue;
        }
        let endpoints = line
            .split("-->")
            .filter_map(parse_endpoint)
            .collect::<Vec<_>>();
        if endpoints.len() < 2 {
            continue;
        }
        let indices = endpoints
            .into_iter()
            .map(|(id, label)| {
                *ids.entry(id).or_insert_with(|| {
                    nodes.push(MermaidNode { label });
                    nodes.len() - 1
                })
            })
            .collect::<Vec<_>>();
        for pair in indices.windows(2) {
            edges.push((pair[0], pair[1]));
        }
    }
    (!nodes.is_empty() && !edges.is_empty()).then_some(MermaidGraph {
        nodes,
        edges,
        direction,
    })
}

fn layout(graph: &MermaidGraph) -> (Vec<(f32, f32)>, f32, f32) {
    let count = graph.nodes.len();
    let mut depths = vec![0usize; count];
    for _ in 0..count {
        let mut changed = false;
        for (source, target) in &graph.edges {
            if depths[*target] < depths[*source] + 1 && depths[*source] + 1 < count {
                depths[*target] = depths[*source] + 1;
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    let max_depth = depths.iter().copied().max().unwrap_or(0);
    let mut positions = vec![(20.0, 20.0); count];
    let mut width = 170.0f32;
    for depth in 0..=max_depth {
        let row = depths
            .iter()
            .enumerate()
            .filter_map(|(index, node_depth)| (*node_depth == depth).then_some(index))
            .collect::<Vec<_>>();
        width = width.max(row.len() as f32 * 150.0 + 20.0);
        for (column, index) in row.into_iter().enumerate() {
            positions[index] = match graph.direction {
                Direction::Vertical => (20.0 + column as f32 * 150.0, 20.0 + depth as f32 * 90.0),
                Direction::Horizontal => (20.0 + depth as f32 * 170.0, 20.0 + column as f32 * 82.0),
            };
        }
    }
    let height = match graph.direction {
        Direction::Vertical => max_depth as f32 * 90.0 + 88.0,
        Direction::Horizontal => {
            let per_depth = |depth| depths.iter().filter(|item| **item == depth).count();
            (0..=max_depth).map(per_depth).max().unwrap_or(1) as f32 * 82.0 + 20.0
        }
    };
    if graph.direction == Direction::Horizontal {
        width = max_depth as f32 * 170.0 + 190.0;
    }
    (positions, width.max(260.0), height.max(100.0))
}

impl MarkdownPlugin for MermaidPlugin {
    fn is_block(&self) -> bool {
        true
    }

    fn name(&self) -> &str {
        "mermaid"
    }

    fn parse(
        &self,
        node: &markdown_ast::Node,
        cx: &MarkdownParseContext<'_>,
    ) -> Option<MarkdownNode> {
        let markdown_ast::Node::Code(code) = node else {
            return None;
        };
        if !code
            .lang
            .as_deref()
            .is_some_and(|lang| lang.eq_ignore_ascii_case("mermaid"))
        {
            return None;
        }
        let graph = parse_flowchart(&code.value)?;
        Some(
            MarkdownNode::new("mermaid", graph)
                .text(code.value.clone())
                .accessibility_label("Mermaid flowchart diagram")
                .markdown(
                    cx.node_source(node)
                        .map(str::to_string)
                        .unwrap_or_else(|| code.value.clone()),
                ),
        )
    }

    fn render(&self, node: &MarkdownNode, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let graph = node.data::<MermaidGraph>().expect("mermaid graph data");
        let (positions, width, height) = layout(graph);
        let edge_color = cx.theme().muted_foreground;
        let edge_data = graph
            .edges
            .iter()
            .map(|(source, target)| (positions[*source], positions[*target]))
            .collect::<Vec<_>>();
        let nodes = positions
            .iter()
            .zip(graph.nodes.iter())
            .map(|((x, y), node)| {
                div()
                    .absolute()
                    .left(px(*x))
                    .top(px(*y))
                    .w(px(112.))
                    .min_h(px(42.))
                    .px_2()
                    .py_1()
                    .rounded(cx.theme().radius_lg)
                    .border_1()
                    .border_color(cx.theme().primary.opacity(0.45))
                    .bg(cx.theme().primary.opacity(0.10))
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_xs()
                    .text_center()
                    .text_color(cx.theme().foreground)
                    .child(node.label.clone())
                    .into_any_element()
            })
            .collect::<Vec<_>>();

        v_flex().w_full().py_2().child(
            div().w_full().overflow_x_scrollbar().child(
                div()
                    .relative()
                    .w(px(width))
                    .h(px(height))
                    .child(
                        canvas(
                            move |bounds, _, _| (edge_data.clone(), edge_color, bounds),
                            move |_, (edges, color, bounds), window, _| {
                                for ((sx, sy), (tx, ty)) in edges {
                                    let start = Point::new(
                                        bounds.origin.x + px(sx + 56.0),
                                        bounds.origin.y + px(sy + 21.0),
                                    );
                                    let end = Point::new(
                                        bounds.origin.x + px(tx + 56.0),
                                        bounds.origin.y + px(ty + 21.0),
                                    );
                                    let mut builder = PathBuilder::stroke(px(1.5));
                                    builder.move_to(start);
                                    builder.line_to(end);
                                    if let Ok(path) = builder.build() {
                                        window.paint_path(path, color);
                                    }
                                    let mut arrow = PathBuilder::stroke(px(1.5));
                                    arrow.move_to(end);
                                    arrow.line_to(Point::new(end.x - px(6.0), end.y - px(6.0)));
                                    arrow.move_to(end);
                                    arrow.line_to(Point::new(end.x - px(6.0), end.y + px(6.0)));
                                    if let Ok(path) = arrow.build() {
                                        window.paint_path(path, color);
                                    }
                                }
                            },
                        )
                        .absolute()
                        .size_full(),
                    )
                    .children(nodes),
            ),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::{Direction, parse_flowchart};

    #[test]
    fn parses_basic_vertical_flowchart() {
        let graph = parse_flowchart("flowchart TD\n  A[Start] --> B[Done]\n").unwrap();
        assert_eq!(graph.direction, Direction::Vertical);
        assert_eq!(graph.nodes.len(), 2);
        assert_eq!(graph.edges, vec![(0, 1)]);
        assert_eq!(graph.nodes[1].label, "Done");
    }

    #[test]
    fn parses_horizontal_chain() {
        let graph = parse_flowchart("graph LR\n  A --> B --> C\n").unwrap();
        assert_eq!(graph.direction, Direction::Horizontal);
        assert_eq!(graph.edges, vec![(0, 1), (1, 2)]);
    }

    #[test]
    fn rejects_non_mermaid_or_edgeless_source() {
        assert!(parse_flowchart("flowchart TD\n  A[Alone]\n").is_none());
        assert!(parse_flowchart("not mermaid").is_none());
    }
}

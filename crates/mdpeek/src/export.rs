pub fn markdown_to_html_document(title: &str, source: &str) -> String {
    let body = markdown::to_html_with_options(source, &markdown::Options::gfm())
        .unwrap_or_else(|error| format!("<pre>Markdown export failed: {error}</pre>"));

    format!(
        r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{}</title>
<style>
body {{ max-width: 760px; margin: 48px auto; padding: 0 24px; color: #24292f; font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
pre, code {{ font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }}
pre {{ overflow-x: auto; padding: 16px; border-radius: 8px; background: #f6f8fa; }}
blockquote {{ margin-left: 0; padding-left: 1em; color: #57606a; border-left: 4px solid #d0d7de; }}
table {{ border-collapse: collapse; }} td, th {{ border: 1px solid #d0d7de; padding: 6px 12px; }}
img {{ max-width: 100%; }}
</style>
</head>
<body>
{}
</body>
</html>"#,
        escape_html(title),
        body
    )
}

pub fn markdown_to_plain_text(source: &str) -> String {
    let mut out = String::new();
    let mut in_fence = false;

    for line in source.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            out.push_str(line);
            out.push('\n');
            continue;
        }

        let mut text = line.to_string();
        for marker in ["#", ">", "-", "*", "+"] {
            if let Some(rest) = text.trim_start().strip_prefix(marker) {
                text = rest.trim_start().to_string();
            }
        }
        text = text
            .replace("**", "")
            .replace("__", "")
            .replace('`', "")
            .replace("~~", "");
        out.push_str(&text);
        out.push('\n');
    }

    out
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_text_strips_common_markdown_markers() {
        assert_eq!(
            markdown_to_plain_text("# Title\n\n**bold** and `code`\n- item\n"),
            "Title\n\nbold and code\nitem\n"
        );
    }

    #[test]
    fn html_export_escapes_title() {
        let html = markdown_to_html_document("<x>", "# Hi");
        assert!(html.contains("<title>&lt;x&gt;</title>"));
        assert!(html.contains("<h1>Hi</h1>"));
    }
}

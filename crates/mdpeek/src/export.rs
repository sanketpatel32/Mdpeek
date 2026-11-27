use crate::text_transform::markdown_headings;

pub fn markdown_to_html_document(title: &str, source: &str) -> String {
    markdown_to_html_document_with_base(title, source, None)
}

pub fn markdown_to_html_document_with_base(
    title: &str,
    source: &str,
    base_href: Option<&str>,
) -> String {
    let body = markdown::to_html_with_options(source, &markdown::Options::gfm())
        .unwrap_or_else(|error| format!("<pre>Markdown export failed: {error}</pre>"));
    let body = add_heading_ids(&body, source);
    let base_tag = base_href
        .map(|href| format!("<base href=\"{}\">", escape_html(href)))
        .unwrap_or_default();
    let fragment_script = r##"<script>
document.addEventListener('click', function (event) {
  var anchor = event.target.closest('a[href^="#"]');
  if (!anchor) return;
  var id;
  try {
    id = decodeURIComponent(anchor.getAttribute('href').slice(1));
  } catch (_) {
    return;
  }
  var target = document.getElementById(id) || document.getElementsByName(id)[0];
  if (!target) return;
  event.preventDefault();
  try {
    var targetUrl = window.location.href.split('#')[0] + '#' + encodeURIComponent(id);
    history.pushState(null, '', targetUrl);
  } catch (_) {}
  target.scrollIntoView();
});
</script>"##;

    format!(
        r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
{}
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
{}
</body>
</html>"#,
        base_tag,
        escape_html(title),
        body,
        fragment_script
    )
}

fn add_heading_ids(html: &str, source: &str) -> String {
    let headings = markdown_headings(source);
    if headings.is_empty() {
        return html.to_string();
    }
    let pattern = regex::Regex::new(r"<h([1-6])>").expect("valid heading pattern");
    let mut output = String::with_capacity(html.len() + headings.len() * 16);
    let mut last = 0;
    let mut next_heading = 0;
    for captures in pattern.captures_iter(html) {
        let Some(whole) = captures.get(0) else {
            continue;
        };
        output.push_str(&html[last..whole.start()]);
        let level = captures[1].parse::<usize>().unwrap_or_default();
        if headings
            .get(next_heading)
            .is_some_and(|heading| heading.level == level)
        {
            let heading = &headings[next_heading];
            output.push_str(&format!("<h{} id=\"{}\">", heading.level, heading.slug));
            next_heading += 1;
        } else {
            output.push_str(whole.as_str());
        }
        last = whole.end();
    }
    output.push_str(&html[last..]);
    output
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
        for marker in ["# ", "> ", "- ", "* ", "+ "] {
            if let Some(rest) = text.trim_start().strip_prefix(marker) {
                text = rest.trim_start().to_string();
                break;
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
        assert!(html.contains("<h1 id=\"hi\">Hi</h1>"));
        assert!(html.contains("a[href^=\"#\"]"));
    }

    #[test]
    fn pdf_export_contains_valid_document_structure() {
        let pdf = markdown_to_pdf("Title", "# Heading\n\nBody text");
        assert!(pdf.starts_with(b"%PDF-1.4"));
        assert!(pdf.windows(6).any(|window| window == b"%%EOF\n"));
        assert!(pdf.windows(7).any(|window| window == b"/Type /"));
    }
}

pub fn markdown_to_pdf(title: &str, source: &str) -> Vec<u8> {
    let text = format!("{title}\n\n{}", markdown_to_plain_text(source));
    let lines = text
        .lines()
        .flat_map(|line| wrap_pdf_line(line, 88))
        .collect::<Vec<_>>();
    let pages = lines.chunks(48).collect::<Vec<_>>();
    let page_count = pages.len().max(1);
    let font_id = 3;
    let first_page_id = 4;
    let content_id = |page: usize| first_page_id + page_count + page;
    let kids = (0..page_count)
        .map(|page| format!("{} 0 R", first_page_id + page))
        .collect::<Vec<_>>()
        .join(" ");
    let mut objects = vec![
        (1, "<< /Type /Catalog /Pages 2 0 R >>".to_string()),
        (
            2,
            format!("<< /Type /Pages /Kids [{kids}] /Count {page_count} >>"),
        ),
        (
            font_id,
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
        ),
    ];
    for page in 0..page_count {
        objects.push((
            first_page_id + page,
            format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {} 0 R >>",
                content_id(page)
            ),
        ));
    }
    for (page, lines) in pages.iter().enumerate() {
        let body = lines
            .iter()
            .map(|line| format!("({}) Tj T*", pdf_escape(line)))
            .collect::<Vec<_>>()
            .join("\n");
        let stream = format!("BT /F1 11 Tf 50 744 Td 15 TL\n{body}\nET");
        objects.push((
            content_id(page),
            format!(
                "<< /Length {} >>\nstream\n{stream}\nendstream",
                stream.len()
            ),
        ));
    }
    objects.sort_by_key(|(id, _)| *id);
    let mut pdf = b"%PDF-1.4\n".to_vec();
    let mut offsets = vec![0usize; objects.len() + 1];
    for (id, object) in &objects {
        offsets[*id] = pdf.len();
        pdf.extend_from_slice(format!("{id} 0 obj\n{object}\nendobj\n").as_bytes());
    }
    let xref = pdf.len();
    pdf.extend_from_slice(format!("xref\n0 {}\n", objects.len() + 1).as_bytes());
    pdf.extend_from_slice(b"0000000000 65535 f \n");
    for offset in offsets.iter().skip(1) {
        pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    pdf.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            objects.len() + 1
        )
        .as_bytes(),
    );
    pdf
}

fn wrap_pdf_line(line: &str, width: usize) -> Vec<String> {
    let normalized = line
        .chars()
        .map(|ch| if ch.is_ascii() { ch } else { '?' })
        .collect::<String>();
    if normalized.is_empty() {
        return vec![String::new()];
    }
    let mut lines = Vec::new();
    let mut remaining = normalized.as_str();
    while remaining.len() > width {
        let split = remaining[..width].rfind(' ').unwrap_or(width).max(1);
        lines.push(remaining[..split].trim_end().to_string());
        remaining = remaining[split..].trim_start();
    }
    lines.push(remaining.to_string());
    lines
}

fn pdf_escape(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('(', "\\(")
        .replace(')', "\\)")
}

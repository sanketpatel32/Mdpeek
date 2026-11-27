pub fn to_markdown_table(source: &str) -> String {
    let delimiter = if source
        .lines()
        .next()
        .is_some_and(|line| line.contains('\t'))
    {
        b'\t'
    } else {
        b','
    };
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(delimiter)
        .flexible(true)
        .has_headers(false)
        .from_reader(source.as_bytes());
    let rows = reader
        .records()
        .filter_map(Result::ok)
        .map(|record| {
            record
                .iter()
                .map(|cell| cell.replace('|', "\\|").replace('\n', " "))
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    let Some(header) = rows.first() else {
        return String::new();
    };
    let mut markdown = format!("\n| {} |\n", header.join(" | "));
    let separator = header.iter().map(|_| " ---").collect::<Vec<_>>().join(" |");
    markdown.push_str(&format!("|{}|\n", separator));
    for row in rows.iter().skip(1) {
        markdown.push_str(&format!("| {} |\n", row.join(" | ")));
    }
    markdown.push('\n');
    markdown
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_preview_uses_valid_table_separator() {
        assert_eq!(
            to_markdown_table("name,value\nAlpha,1\n"),
            "\n| name | value |\n| --- | ---|\n| Alpha | 1 |\n\n"
        );
    }
}

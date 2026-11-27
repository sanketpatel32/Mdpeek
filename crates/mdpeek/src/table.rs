#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Alignment {
    Left,
    Center,
    Right,
    None,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MarkdownTable {
    pub rows: Vec<Vec<String>>,
    pub alignments: Vec<Alignment>,
    pub start: usize,
    pub end: usize,
}

fn split_row(line: &str) -> Vec<String> {
    let trimmed = line.trim().trim_start_matches('|').trim_end_matches('|');
    let mut cells = Vec::new();
    let mut cell = String::new();
    let mut escaped = false;
    for ch in trimmed.chars() {
        if escaped {
            cell.push(ch);
            escaped = false;
        } else if ch == '\\' {
            escaped = true;
        } else if ch == '|' {
            cells.push(cell.trim().to_string());
            cell.clear();
        } else {
            cell.push(ch);
        }
    }
    cells.push(cell.trim().to_string());
    cells
}

fn parse_alignment(cell: &str) -> Option<Alignment> {
    let cell = cell.trim();
    if cell.len() < 3 || !cell.chars().all(|ch| matches!(ch, ':' | '-')) || !cell.contains('-') {
        return None;
    }
    Some(match (cell.starts_with(':'), cell.ends_with(':')) {
        (true, true) => Alignment::Center,
        (true, false) => Alignment::Left,
        (false, true) => Alignment::Right,
        (false, false) => Alignment::None,
    })
}

fn emit_alignment(alignment: Alignment, width: usize) -> String {
    let width = width.max(3);
    match alignment {
        Alignment::Left => format!(":{}", "-".repeat(width - 1)),
        Alignment::Center => format!(":{}:", "-".repeat(width - 2)),
        Alignment::Right => format!("{}:", "-".repeat(width - 1)),
        Alignment::None => "-".repeat(width),
    }
}

pub fn parse_table_at(text: &str, cursor: usize) -> Option<MarkdownTable> {
    let cursor = cursor.min(text.len());
    let mut lines = Vec::new();
    let mut offset = 0;
    for line in text.split_inclusive('\n') {
        let content = line.strip_suffix('\n').unwrap_or(line);
        lines.push((offset, content));
        offset += line.len();
    }
    if text.ends_with('\n') || lines.is_empty() {
        lines.push((offset, ""));
    }
    let row_index = lines
        .iter()
        .position(|(start, line)| cursor >= *start && cursor <= start + line.len())?;
    if !lines[row_index].1.contains('|') {
        return None;
    }
    let mut top = row_index;
    while top > 0 && lines[top - 1].1.trim().contains('|') && !lines[top - 1].1.trim().is_empty() {
        top -= 1;
    }
    let mut bottom = row_index;
    while bottom + 1 < lines.len()
        && lines[bottom + 1].1.trim().contains('|')
        && !lines[bottom + 1].1.trim().is_empty()
    {
        bottom += 1;
    }
    if bottom - top < 2 {
        return None;
    }

    let delimiter_index = top + 1;
    let delimiter_cells = split_row(lines[delimiter_index].1);
    let alignments = delimiter_cells
        .iter()
        .map(|cell| parse_alignment(cell))
        .collect::<Option<Vec<_>>>()?;
    let column_count = alignments.len();
    let header = split_row(lines[top].1);
    if header.len() != column_count {
        return None;
    }

    let mut rows = vec![header];
    for (_, line) in &lines[top + 2..=bottom] {
        let mut cells = split_row(line);
        cells.resize(column_count, String::new());
        cells.truncate(column_count);
        rows.push(cells);
    }
    let start = lines[top].0;
    let end = lines[bottom].0 + lines[bottom].1.len();
    Some(MarkdownTable {
        rows,
        alignments,
        start,
        end,
    })
}

pub fn emit_table(table: &MarkdownTable) -> String {
    let column_count = table.alignments.len();
    let mut widths = vec![3usize; column_count];
    for row in &table.rows {
        for (index, cell) in row.iter().enumerate().take(column_count) {
            widths[index] = widths[index].max(cell.chars().count());
        }
    }
    let emit_row = |cells: &[String]| {
        let cells = (0..column_count)
            .map(|index| {
                let cell = cells.get(index).map(String::as_str).unwrap_or_default();
                format!(" {:width$} ", cell, width = widths[index])
            })
            .collect::<Vec<_>>()
            .join("|");
        format!("|{cells}|")
    };
    let mut output = Vec::new();
    output.push(emit_row(&table.rows[0]));
    let delimiter = table
        .alignments
        .iter()
        .enumerate()
        .map(|(index, alignment)| format!(" {} ", emit_alignment(*alignment, widths[index])))
        .collect::<Vec<_>>()
        .join("|");
    output.push(format!("|{delimiter}|"));
    for row in table.rows.iter().skip(1) {
        output.push(emit_row(row));
    }
    output.join("\n")
}

impl MarkdownTable {
    pub fn set_cells(&mut self, rows: Vec<Vec<String>>) {
        let columns = self.alignments.len();
        self.rows = rows
            .into_iter()
            .map(|mut row| {
                row.resize(columns, String::new());
                row.truncate(columns);
                row
            })
            .collect();
    }

    pub fn add_row(&mut self) {
        self.rows.push(vec![String::new(); self.alignments.len()]);
    }

    pub fn add_column(&mut self) {
        self.alignments.push(Alignment::None);
        for row in &mut self.rows {
            row.push(String::new());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Alignment, MarkdownTable, emit_table, parse_table_at};

    #[test]
    fn parses_table_at_cursor_and_preserves_body() {
        let text = "before\n| Name | Value |\n| :--- | ---: |\n| A | 1 |\nafter\n";
        let table = parse_table_at(text, text.find("| A").unwrap()).unwrap();
        assert_eq!(table.rows.len(), 2);
        assert_eq!(table.alignments, vec![Alignment::Left, Alignment::Right]);
        assert_eq!(
            &text[table.start..table.end],
            "| Name | Value |\n| :--- | ---: |\n| A | 1 |"
        );
    }

    #[test]
    fn emits_padded_table() {
        let mut table = MarkdownTable {
            rows: vec![
                vec!["Name".into(), "Value".into()],
                vec!["A".into(), "1".into()],
            ],
            alignments: vec![Alignment::None, Alignment::Right],
            start: 0,
            end: 0,
        };
        table.add_row();
        table.add_column();
        let emitted = emit_table(&table);
        assert!(emitted.contains("| Name | Value |     |"));
        assert!(emitted.lines().nth(1).unwrap().contains("---:"));
    }
}

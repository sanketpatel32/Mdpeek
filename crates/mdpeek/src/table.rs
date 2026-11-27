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
    let mut chars = trimmed.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\\' && chars.peek() == Some(&'|') {
            chars.next();
            cell.push('|');
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
    let mut active_fence = None;
    let mut fenced_lines = Vec::new();
    for (_, line) in &lines {
        let trimmed = line.trim_start();
        let marker = if trimmed.starts_with("```") {
            Some('`')
        } else if trimmed.starts_with("~~~") {
            Some('~')
        } else {
            None
        };
        let fence = marker.is_some_and(|marker| active_fence.is_none_or(|active| active == marker));
        fenced_lines.push(active_fence.is_some() || fence);
        if fence {
            active_fence = if active_fence.is_some() { None } else { marker };
        }
    }
    if fenced_lines[row_index] || bottom - top < 2 {
        return None;
    }

    let delimiter_index = (top + 1..=bottom).find(|index| {
        !fenced_lines[*index]
            && split_row(lines[*index].1)
                .iter()
                .all(|cell| parse_alignment(cell).is_some())
    })?;
    top = delimiter_index - 1;
    bottom = delimiter_index;
    while bottom + 1 < lines.len()
        && !fenced_lines[bottom + 1]
        && lines[bottom + 1].1.trim().contains('|')
        && !lines[bottom + 1].1.trim().is_empty()
        && !lines[bottom + 1].1.trim_start().starts_with('#')
    {
        bottom += 1;
    }
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
    if bottom >= top + 2 {
        for (_, line) in &lines[top + 2..=bottom] {
            let mut cells = split_row(line);
            cells.resize(column_count, String::new());
            cells.truncate(column_count);
            rows.push(cells);
        }
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
                let cell = cells
                    .get(index)
                    .map(String::as_str)
                    .unwrap_or_default()
                    .replace('|', "\\|");
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

    pub fn remove_row(&mut self, index: usize) {
        if index > 0 && index < self.rows.len() && self.rows.len() > 2 {
            self.rows.remove(index);
        }
    }

    pub fn move_row(&mut self, index: usize, upward: bool) {
        if index == 0 || index >= self.rows.len() {
            return;
        }
        let target = if upward {
            index.saturating_sub(1).max(1)
        } else {
            (index + 1).min(self.rows.len() - 1)
        };
        if target != index {
            self.rows.swap(index, target);
        }
    }

    pub fn remove_column(&mut self, index: usize) {
        if index >= self.alignments.len() || self.alignments.len() <= 1 {
            return;
        }
        self.alignments.remove(index);
        for row in &mut self.rows {
            if index < row.len() {
                row.remove(index);
            }
        }
    }

    pub fn move_column(&mut self, index: usize, left: bool) {
        if index >= self.alignments.len() {
            return;
        }
        let target = if left {
            index.saturating_sub(1)
        } else {
            (index + 1).min(self.alignments.len() - 1)
        };
        if target == index {
            return;
        }
        self.alignments.swap(index, target);
        for row in &mut self.rows {
            if index < row.len() && target < row.len() {
                row.swap(index, target);
            }
        }
    }

    pub fn cycle_alignment(&mut self, index: usize) {
        if let Some(alignment) = self.alignments.get_mut(index) {
            *alignment = match alignment {
                Alignment::None => Alignment::Left,
                Alignment::Left => Alignment::Center,
                Alignment::Center => Alignment::Right,
                Alignment::Right => Alignment::None,
            };
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
    fn escaped_pipes_round_trip() {
        let text = "| A | B |\n| --- | --- |\n| one \\| two | x |\n";
        let table = parse_table_at(text, text.find("one").unwrap()).unwrap();
        assert_eq!(table.rows[1][0], "one | two");
        assert!(emit_table(&table).contains("one \\| two"));
    }

    #[test]
    fn does_not_absorb_following_heading() {
        let text = "| A |\n| --- |\n| x |\n# heading | not table\n";
        let table = parse_table_at(text, text.find("| x").unwrap()).unwrap();
        assert_eq!(table.rows.len(), 2);
        assert!(!text[table.start..table.end].contains("heading"));
    }

    #[test]
    fn row_and_column_operations_update_model() {
        let mut table = MarkdownTable {
            rows: vec![
                vec!["H1".into(), "H2".into()],
                vec!["a".into(), "b".into()],
                vec!["c".into(), "d".into()],
            ],
            alignments: vec![Alignment::None, Alignment::None],
            start: 0,
            end: 0,
        };
        table.move_row(2, true);
        assert_eq!(table.rows[1], vec!["c", "d"]);
        table.move_column(1, true);
        assert_eq!(table.rows[0], vec!["H2", "H1"]);
        table.cycle_alignment(0);
        assert_eq!(table.alignments[0], Alignment::Left);
        table.remove_row(2);
        assert_eq!(table.rows.len(), 2);
        table.remove_column(1);
        assert_eq!(table.rows[0], vec!["H2"]);
    }

    #[test]
    fn row_and_column_operations_preserve_required_structure() {
        let mut table = MarkdownTable {
            rows: vec![vec!["H".into()], vec!["a".into()]],
            alignments: vec![Alignment::None],
            start: 0,
            end: 0,
        };
        table.remove_row(0);
        table.remove_row(1);
        table.remove_column(0);
        table.move_row(1, true);
        assert_eq!(table.rows.len(), 2);
        assert_eq!(table.alignments.len(), 1);
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

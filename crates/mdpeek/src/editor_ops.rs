#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EditResult {
    pub text: String,
    pub start: usize,
    pub end: usize,
}

fn line_range(text: &str, start: usize, end: usize) -> (usize, usize) {
    let start = start.min(end).min(text.len());
    let end = end.max(start).min(text.len());
    let line_start = text[..start].rfind('\n').map_or(0, |index| index + 1);
    let effective_end = if end != start && end > 0 && text.as_bytes()[end - 1] == b'\n' {
        end - 1
    } else {
        end
    };
    let line_end = text[effective_end..]
        .find('\n')
        .map_or(text.len(), |index| effective_end + index);
    (line_start, line_end)
}

pub fn duplicate_lines(text: &str, start: usize, end: usize) -> EditResult {
    let (line_start, line_end) = line_range(text, start, end);
    let block = &text[line_start..line_end];
    let separator = "\n";
    let mut output = String::with_capacity(text.len() + block.len() + 1);
    output.push_str(&text[..line_end]);
    output.push_str(separator);
    output.push_str(block);
    output.push_str(&text[line_end..]);
    let new_start = line_end + separator.len();
    EditResult {
        text: output,
        start: new_start,
        end: new_start + block.len(),
    }
}

pub fn move_lines(text: &str, start: usize, end: usize, upward: bool) -> EditResult {
    let (line_start, line_end) = line_range(text, start, end);
    if upward {
        if line_start == 0 {
            return unchanged(text, start, end);
        }
        let previous_end = line_start - 1;
        let previous_start = text[..previous_end]
            .rfind('\n')
            .map_or(0, |index| index + 1);
        let before = &text[..previous_start];
        let above = &text[previous_start..previous_end];
        let block = &text[line_start..line_end];
        let rest = &text[line_end..];
        let output = format!("{before}{block}\n{above}{rest}");
        let shift = line_start - previous_start;
        EditResult {
            text: output,
            start: start.saturating_sub(shift),
            end: end.saturating_sub(shift),
        }
    } else {
        if line_end >= text.len() || text.as_bytes().get(line_end) != Some(&b'\n') {
            return unchanged(text, start, end);
        }
        let below_start = line_end + 1;
        let below_end = text[below_start..]
            .find('\n')
            .map_or(text.len(), |index| below_start + index);
        let before = &text[..line_start];
        let block = &text[line_start..line_end];
        let below = &text[below_start..below_end];
        let rest = &text[below_end..];
        let output = format!("{before}{below}\n{block}{rest}");
        let shift = below.len() + 1;
        EditResult {
            text: output,
            start: start + shift,
            end: end + shift,
        }
    }
}

pub fn join_line(text: &str, position: usize) -> EditResult {
    let position = position.min(text.len());
    let Some(line_end) = text[position..].find('\n').map(|index| position + index) else {
        return unchanged(text, position, position);
    };
    let line_start = text[..position].rfind('\n').map_or(0, |index| index + 1);
    let next_start = line_end + 1;
    let next_end = text[next_start..]
        .find('\n')
        .map_or(text.len(), |index| next_start + index);
    let prefix = &text[..line_start];
    let current = text[line_start..line_end].trim_end();
    let next = text[next_start..next_end].trim_start();
    let joiner = if current.is_empty() || next.is_empty() {
        ""
    } else {
        " "
    };
    let mut output = String::with_capacity(text.len());
    output.push_str(prefix);
    output.push_str(current);
    output.push_str(joiner);
    output.push_str(next);
    output.push_str(&text[next_end..]);
    let caret = line_start + current.len() + joiner.len();
    EditResult {
        text: output,
        start: caret,
        end: caret,
    }
}

pub fn line_start_offset(text: &str, one_indexed_line: usize) -> Option<usize> {
    if one_indexed_line == 0 {
        return None;
    }
    let mut line = 1;
    for (index, byte) in text.bytes().enumerate() {
        if line == one_indexed_line {
            return Some(index);
        }
        if byte == b'\n' {
            line += 1;
        }
    }
    (line == one_indexed_line).then_some(text.len())
}

fn unchanged(text: &str, start: usize, end: usize) -> EditResult {
    EditResult {
        text: text.to_string(),
        start,
        end,
    }
}

#[cfg(test)]
mod tests {
    use super::{duplicate_lines, join_line, line_start_offset, move_lines};

    #[test]
    fn duplicate_line_moves_selection_to_copy() {
        let result = duplicate_lines("one\ntwo\nthree", 5, 5);
        assert_eq!(result.text, "one\ntwo\ntwo\nthree");
        assert_eq!(&result.text[result.start..result.end], "two");
    }

    #[test]
    fn move_lines_swaps_adjacent_blocks() {
        let result = move_lines("one\ntwo\nthree", 4, 7, true);
        assert_eq!(result.text, "two\none\nthree");
        assert_eq!(&result.text[result.start..result.end], "two");
        let result = move_lines("one\ntwo\nthree", 4, 7, false);
        assert_eq!(result.text, "one\nthree\ntwo");
        assert_eq!(&result.text[result.start..result.end], "two");
    }

    #[test]
    fn move_lines_is_noop_at_document_edges() {
        assert_eq!(move_lines("one\ntwo", 0, 3, true).text, "one\ntwo");
        assert_eq!(move_lines("one\ntwo", 4, 7, false).text, "one\ntwo");
    }

    #[test]
    fn join_line_collapses_whitespace() {
        let result = join_line("first  \n   second\nthird", 2);
        assert_eq!(result.text, "first second\nthird");
        assert_eq!(result.start, 6);
    }

    #[test]
    fn join_blank_line_preserves_previous_line_break() {
        let result = join_line("# Heading\n\nparagraph", 10);
        assert_eq!(result.text, "# Heading\nparagraph");
    }

    #[test]
    fn line_selection_ending_at_line_start_excludes_that_line() {
        let result = duplicate_lines("one\ntwo\nthree", 0, 4);
        assert_eq!(result.text, "one\none\ntwo\nthree");
    }

    #[test]
    fn line_offsets_are_one_indexed() {
        assert_eq!(line_start_offset("one\ntwo", 1), Some(0));
        assert_eq!(line_start_offset("one\ntwo", 2), Some(4));
        assert_eq!(line_start_offset("one\ntwo", 0), None);
    }
}

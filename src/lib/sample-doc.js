// Sample document shown from the welcome screen ("See a sample document") so a
// first-run user can see mdpeek rendering before they have any file at hand.
// Opened as a pathless doc in view mode — edits land in Save As and it never
// pollutes the recents list.

export const SAMPLE_DOC = `# Welcome to mdpeek

A featherlight file viewer & Markdown editor. This sample shows what mdpeek
renders — press \`Ctrl+E\` to see the raw text behind it.

## Formatting basics

Text can be **bold**, *italic*, ~~struck~~, \`inline code\`, ==highlighted==, or
a [link](https://github.com/sanketpatel32/Mdpeek). Lists nest cleanly:

1. Ordered items keep their rhythm
2. And so do their continuations
   - Nested bullet
   - Another level

- [x] Task lists are interactive — click a checkbox
- [ ] Unfinished work stays visible

## Code, quotes and tables

\`\`\`js
// Fenced code keeps the mono stack and syntax highlighting
const greet = (name) => \`Hello, \${name}!\`;
\`\`\`

> Blockquotes read as pulled prose, with an accent stripe down the side.

| Feature | Works offline | Shortcut |
| --- | --- | --- |
| Command palette | Yes | Ctrl+Shift+P |
| Quick switcher | Yes | Ctrl+P |
| Edit / view | Yes | Ctrl+E |

## Math, diagrams and footnotes

Inline math like $E = mc^2$ renders when the file needs it, and footnotes
survive round-trips[^1].

[^1]: Click a footnote reference to jump to its note.
`;

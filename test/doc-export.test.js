 import { describe, it, expect } from 'vitest';
 import { stripFrontmatter, convertTaskMarkers, prepareExportText } from '../src/lib/doc-export.js';
 
 describe('stripFrontmatter', () => {
   it('removes YAML frontmatter header', () => {
     const input = '---\ntitle: Doc\nauthor: Me\n---\n# Real Content';
     expect(stripFrontmatter(input)).toBe('# Real Content');
   });
 
   it('returns unchanged text if no frontmatter present', () => {
     const input = '# Heading\nSome content';
     expect(stripFrontmatter(input)).toBe('# Heading\nSome content');
   });
 
   it('handles empty input gracefully', () => {
     expect(stripFrontmatter('')).toBe('');
     expect(stripFrontmatter(null)).toBe('');
   });
 });
 
 describe('convertTaskMarkers', () => {
   it('converts GFM checkboxes to unicode symbols', () => {
     const input = '- [ ] Todo item\n- [x] Done item';
     const output = convertTaskMarkers(input, 'unicode');
     expect(output).toBe('☐ Todo item\n☑ Done item');
   });
 
   it('converts GFM checkboxes to plain text markers', () => {
     const input = '- [ ] Todo item\n- [x] Done item';
     const output = convertTaskMarkers(input, 'plain');
     expect(output).toBe('- Todo item\n- [done] Done item');
   });
 });
 
 describe('prepareExportText', () => {
   it('applies options and normalizes line endings', () => {
     const input = '---\ntitle: Test\n---\r\n- [ ] Task\r\n';
     const result = prepareExportText(input, { removeFrontmatter: true, formatTasks: true });
     expect(result).toBe('☐ Task');
   });
 });

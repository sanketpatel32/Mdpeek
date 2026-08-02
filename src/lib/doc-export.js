 // v0.58.0: Pure text processing utilities for document export and raw copying.
 // Formats Markdown for raw export, strips YAML frontmatter, and normalizes line endings.
 
 export function stripFrontmatter(text) {
   if (!text) return '';
   return String(text).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
 }
 
 export function convertTaskMarkers(text, mode = 'unicode') {
   if (!text) return '';
   if (mode === 'unicode') {
     return String(text)
       .replace(/^(\s*)[-*+]\s+\[ \]/gm, '$1☐')
       .replace(/^(\s*)[-*+]\s+\[[xX]\]/gm, '$1☑');
   }
   if (mode === 'plain') {
     return String(text)
       .replace(/^(\s*)[-*+]\s+\[ \]/gm, '$1-')
       .replace(/^(\s*)[-*+]\s+\[[xX]\]/gm, '$1- [done]');
   }
   return text;
 }
 
 export function prepareExportText(markdownText, { removeFrontmatter = false, formatTasks = false } = {}) {
   let result = markdownText || '';
   if (removeFrontmatter) {
     result = stripFrontmatter(result);
   }
   if (formatTasks) {
     result = convertTaskMarkers(result, 'unicode');
   }
   // Normalize line endings and trim trailing whitespace
   return result.replace(/\r\n/g, '\n').trim();
 }

 // v0.58.0: Pure Table of Contents generator for Markdown documents.
 // Extracts headings (# to ######), generates clean GitHub-compatible slugs,
 // and builds a formatted Markdown TOC list with relative indentation.
 
 export function slugify(text) {
   if (!text) return '';
   return String(text)
     .trim()
     .toLowerCase()
     .replace(/<[^>]+>/g, '') // remove inline html
     .replace(/[^\w\s-]/g, '') // remove non-word chars except space and hyphen
     .replace(/\s+/g, '-'); // spaces to hyphens
 }
 
 export function extractHeadings(markdownText) {
   if (!markdownText) return [];
   const lines = markdownText.split('\n');
   const headings = [];
   let inCodeBlock = false;
 
   for (let i = 0; i < lines.length; i++) {
     const line = lines[i];
     // Track code fences to avoid picking up # inside code blocks
     if (/^\s*```/.test(line)) {
       inCodeBlock = !inCodeBlock;
       continue;
     }
     if (inCodeBlock) continue;
 
     const match = line.match(/^(#{1,6})\s+(.+)$/);
     if (match) {
       const level = match[1].length;
       const text = match[2].trim().replace(/\s+#+$/, ''); // trim trailing #
       const slug = slugify(text);
       headings.push({ level, text, slug, line: i + 1 });
     }
   }
 
   return headings;
 }
 
 export function generateTocMarkdown(markdownText, { maxLevel = 4, header = '## Table of Contents' } = {}) {
   const headings = extractHeadings(markdownText).filter((h) => h.level <= maxLevel);
   if (headings.length === 0) return '';
 
   const minLevel = Math.min(...headings.map((h) => h.level));
   const items = headings.map((h) => {
     const indent = '  '.repeat(Math.max(0, h.level - minLevel));
     return `${indent}- [${h.text}](#${h.slug})`;
   });
 
   const title = header ? `${header}\n\n` : '';
   return `${title}${items.join('\n')}\n`;
 }

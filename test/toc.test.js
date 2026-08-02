 import { describe, it, expect } from 'vitest';
 import { slugify, extractHeadings, generateTocMarkdown } from '../src/lib/toc.js';
 
 describe('slugify', () => {
   it('converts title to lowercase hyphenated slug', () => {
     expect(slugify('Hello World!')).toBe('hello-world');
   });
 
   it('strips inline HTML tags', () => {
     expect(slugify('Getting <code>Started</code>')).toBe('getting-started');
   });
 
   it('handles empty input', () => {
     expect(slugify('')).toBe('');
     expect(slugify(null)).toBe('');
   });
 });
 
 describe('extractHeadings', () => {
   it('extracts markdown headings with levels', () => {
     const md = '# Title\n\nSome text\n\n## Section 1\n\n### Sub-section\n';
     const headings = extractHeadings(md);
     expect(headings).toEqual([
       { level: 1, text: 'Title', slug: 'title', line: 1 },
       { level: 2, text: 'Section 1', slug: 'section-1', line: 5 },
       { level: 3, text: 'Sub-section', slug: 'sub-section', line: 7 },
     ]);
   });
 
   it('ignores headings inside code blocks', () => {
     const md = '# Real Heading\n```\n# Fake Heading\n```\n## Another Real Heading';
     const headings = extractHeadings(md);
     expect(headings.map((h) => h.text)).toEqual(['Real Heading', 'Another Real Heading']);
   });
 });
 
 describe('generateTocMarkdown', () => {
   it('generates formatted TOC markdown list', () => {
     const md = '# Introduction\n\n## Getting Started\n\n### Installation\n';
     const toc = generateTocMarkdown(md);
     expect(toc).toContain('## Table of Contents');
     expect(toc).toContain('- [Introduction](#introduction)');
     expect(toc).toContain('  - [Getting Started](#getting-started)');
     expect(toc).toContain('    - [Installation](#installation)');
   });
 
   it('returns empty string if no headings found', () => {
     expect(generateTocMarkdown('Just plain text')).toBe('');
   });
 });

 import { describe, it, expect, vi } from 'vitest';
 import { extractCodeText, enhanceCodeBlocks } from '../src/lib/code-copy.js';
 
 describe('extractCodeText', () => {
   it('returns empty string for null/falsy element', () => {
     expect(extractCodeText(null)).toBe('');
   });
 
   it('extracts text inside code child', () => {
     const pre = document.createElement('pre');
     const code = document.createElement('code');
     code.textContent = 'const x = 42;';
     pre.appendChild(code);
     expect(extractCodeText(pre)).toBe('const x = 42;');
   });
 
   it('falls back to pre textContent if no code child', () => {
     const pre = document.createElement('pre');
     pre.textContent = 'plain pre text';
     expect(extractCodeText(pre)).toBe('plain pre text');
   });
 });
 
 describe('enhanceCodeBlocks', () => {
   it('handles null container without error', () => {
     expect(() => enhanceCodeBlocks(null)).not.toThrow();
   });
 
   it('adds copy button to pre code blocks', () => {
     const container = document.createElement('div');
     container.innerHTML = '<pre><code>console.log("hello");</code></pre>';
     enhanceCodeBlocks(container);
 
     const btn = container.querySelector('.code-copy-btn');
     expect(btn).not.toBeNull();
     expect(btn.textContent).toBe('Copy');
   });
 
   it('is idempotent across repeated calls (no duplicate buttons)', () => {
     const container = document.createElement('div');
     container.innerHTML = '<pre><code>console.log("hello");</code></pre>';
     enhanceCodeBlocks(container);
     enhanceCodeBlocks(container);
 
     const btns = container.querySelectorAll('.code-copy-btn');
     expect(btns.length).toBe(1);
   });
 
   it('copies code text when clicked', async () => {
     const container = document.createElement('div');
     container.innerHTML = '<pre><code>const a = 1;</code></pre>';
     const writeTextFn = vi.fn().mockResolvedValue(undefined);
 
     enhanceCodeBlocks(container, writeTextFn);
     const btn = container.querySelector('.code-copy-btn');
     btn.click();
 
     await new Promise((resolve) => setTimeout(resolve, 10));
     expect(writeTextFn).toHaveBeenCalledWith('const a = 1;');
     expect(btn.textContent).toBe('✓ Copied');
   });
 });

 // v0.57.0: One-click copy button for Markdown code blocks.
 // Scans a rendered container for `<pre>` elements containing `<code>` blocks,
 // injects a top-right "Copy" button if not already present, and handles clipboard copy.
 
 export function extractCodeText(preElement) {
   if (!preElement) return '';
   const code = preElement.querySelector('code') || preElement;
   return code.textContent || '';
 }
 
 export function enhanceCodeBlocks(container, writeTextFn = null) {
   if (!container) return;
   const pres = container.querySelectorAll('pre');
   pres.forEach((pre) => {
     // Skip if wrapper or copy button already present
     if (pre.querySelector('.code-copy-btn')) return;
 
     // Ensure pre has relative positioning context for absolute button placement
     if (!pre.style.position) {
       pre.style.position = 'relative';
     }
 
     const btn = document.createElement('button');
     btn.type = 'button';
     btn.className = 'code-copy-btn';
     btn.setAttribute('aria-label', 'Copy code to clipboard');
     btn.title = 'Copy code';
     btn.textContent = 'Copy';
 
     btn.addEventListener('click', async (e) => {
       e.stopPropagation();
       const text = extractCodeText(pre);
       try {
         if (writeTextFn) {
           await writeTextFn(text);
         } else if (navigator.clipboard && navigator.clipboard.writeText) {
           await navigator.clipboard.writeText(text);
         }
         btn.textContent = '✓ Copied';
         btn.classList.add('copied');
         setTimeout(() => {
           btn.textContent = 'Copy';
           btn.classList.remove('copied');
         }, 2000);
       } catch (err) {
         btn.textContent = 'Failed';
         setTimeout(() => {
           btn.textContent = 'Copy';
         }, 2000);
       }
     });
 
     pre.appendChild(btn);
   });
 }

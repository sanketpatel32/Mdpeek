 // v0.57.0: Pure navigation & jump helper for the PDF viewer.
 // Calculates active page from visible page ratios, clamps target page jumps,
 // and computes next zoom scale levels.
 
 export function clampPage(page, totalPages) {
   const p = parseInt(page, 10);
   if (isNaN(p)) return 1;
   if (p < 1) return 1;
   if (p > totalPages) return totalPages;
   return p;
 }
 
 export function calculateActivePage(pageRatiosMap, defaultPage = 1) {
   if (!pageRatiosMap || pageRatiosMap.size === 0) return defaultPage;
   let maxRatio = -1;
   let activePage = defaultPage;
   for (const [pageNum, ratio] of pageRatiosMap.entries()) {
     if (ratio > maxRatio) {
       maxRatio = ratio;
       activePage = pageNum;
     }
   }
   return activePage;
 }
 
 export function calculateZoomScale(currentScale, delta) {
   const newScale = Math.round((currentScale + delta) * 100) / 100;
   return Math.min(Math.max(newScale, 0.5), 3.0);
 }

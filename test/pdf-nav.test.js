 import { describe, it, expect } from 'vitest';
 import { clampPage, calculateActivePage, calculateZoomScale } from '../src/lib/pdf-nav.js';
 
 describe('clampPage', () => {
   it('clamps lower bound to 1', () => {
     expect(clampPage(0, 10)).toBe(1);
     expect(clampPage(-5, 10)).toBe(1);
   });
 
   it('clamps upper bound to totalPages', () => {
     expect(clampPage(15, 10)).toBe(10);
     expect(clampPage(10, 10)).toBe(10);
   });
 
   it('returns valid numeric page', () => {
     expect(clampPage(5, 10)).toBe(5);
     expect(clampPage('4', 10)).toBe(4);
   });
 
   it('handles NaN/falsy inputs gracefully', () => {
     expect(clampPage(null, 10)).toBe(1);
     expect(clampPage(undefined, 10)).toBe(1);
     expect(clampPage('abc', 10)).toBe(1);
   });
 });
 
 describe('calculateActivePage', () => {
   it('returns defaultPage if map is empty/null', () => {
     expect(calculateActivePage(null, 1)).toBe(1);
     expect(calculateActivePage(new Map(), 2)).toBe(2);
   });
 
   it('returns page with highest visibility ratio', () => {
     const map = new Map([
       [1, 0.2],
       [2, 0.85],
       [3, 0.1],
     ]);
     expect(calculateActivePage(map, 1)).toBe(2);
   });
 });
 
 describe('calculateZoomScale', () => {
   it('increases scale within bounds', () => {
     expect(calculateZoomScale(1.0, 0.25)).toBe(1.25);
   });
 
   it('decreases scale within bounds', () => {
     expect(calculateZoomScale(1.0, -0.25)).toBe(0.75);
   });
 
   it('clamps to max bound 3.0', () => {
     expect(calculateZoomScale(2.9, 0.5)).toBe(3.0);
   });
 
   it('clamps to min bound 0.5', () => {
     expect(calculateZoomScale(0.6, -0.3)).toBe(0.5);
   });
 });

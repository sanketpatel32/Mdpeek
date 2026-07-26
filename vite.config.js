import { defineConfig } from 'vite';

// Tauri expects a fixed dev port and an empty base path.
// (v0.34.1: the app version is read client-side via a `package.json` import
// in src/main.js — no build-time define needed.)
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: 'esnext',
  },
});

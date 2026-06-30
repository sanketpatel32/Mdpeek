import { defineConfig } from 'vite';

// Tauri expects a fixed dev port and an empty base path.
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

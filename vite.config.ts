// vite.config.ts — 渲染进程（React + Vite），dev server + build
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSupportImage } from './src/build/supportImage';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(root, 'src/renderer'),
  plugins: [react()],
  resolve: {
    alias: {
      // Clean source checkouts use the placeholder; local builds prefer private artwork.
      // Release builds fail instead of silently shipping the placeholder.
      '@author-support-image': resolveSupportImage(root, process.env.WINBOX_SUPPORT_IMAGE, process.env.WINBOX_RELEASE_BUILD === '1'),
    },
  },
  base: './',
  build: {
    outDir: resolve(root, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome130',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});

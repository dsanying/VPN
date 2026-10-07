import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: path.join(import.meta.dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: path.join(import.meta.dirname, 'dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.join(import.meta.dirname, 'src/renderer/index.html'),
        // 独立更新弹窗入口（Conduit mini 更新窗，UpdateService.createUpdatePopup 加载）——与主窗共享 index.css token/字体。
        updatePopup: path.join(import.meta.dirname, 'src/renderer/update-popup.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@': path.join(import.meta.dirname, 'src/renderer'),
      '@shared': path.join(import.meta.dirname, 'src/shared'),
      '@renderer': path.join(import.meta.dirname, 'src/renderer'),
      '@components': path.join(import.meta.dirname, 'src/renderer/components'),
      '@lib': path.join(import.meta.dirname, 'src/renderer/lib'),
      '@hooks': path.join(import.meta.dirname, 'src/renderer/hooks'),
      '@store': path.join(import.meta.dirname, 'src/renderer/store'),
      '@pages': path.join(import.meta.dirname, 'src/renderer/pages'),
      '@bridge': path.join(import.meta.dirname, 'src/renderer/bridge'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});

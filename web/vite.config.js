import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 部署在 Cloud Run 的 /dashboard 路徑下；本機開發時把 /api 轉到本機後端
export default defineConfig({
  base: '/dashboard/',
  plugins: [react()],
  build: { outDir: 'dist', assetsDir: 'assets', sourcemap: false, chunkSizeWarningLimit: 800 },
  server: { proxy: { '/api': 'http://localhost:8080' } },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = process.env.VITE_DEV_API_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  // Reuse the existing product assets while the legacy frontend is still present.
  publicDir: '../public',
  server: {
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/labels': { target: backend, changeOrigin: true },
      '/healthz': { target: backend, changeOrigin: true },
    },
  },
});

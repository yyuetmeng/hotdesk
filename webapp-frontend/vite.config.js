import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const backend = process.env.VITE_DEV_API_TARGET ?? 'http://localhost:3000';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
  plugins: [react()],
  // Reuse the existing product assets while the legacy frontend is still present.
  publicDir: '../public',
  server: {
    proxy: {
      '/api/auth': { target: env.VITE_DEV_AUTH_TARGET || 'http://localhost:5000', changeOrigin: true },
      '/api': { target: backend, changeOrigin: true },
      '/labels': { target: backend, changeOrigin: true },
      '/healthz': { target: backend, changeOrigin: true },
    },
  },
  };
});

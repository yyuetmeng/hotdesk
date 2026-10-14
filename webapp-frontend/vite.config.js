import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const backend = process.env.VITE_DEV_API_TARGET ?? 'http://localhost:3000';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  // Flask API (auth + admin floor plans). VITE_FLASK_TARGET is the older name, still honored.
  const flaskBackend =
    env.VITE_DEV_AUTH_TARGET || process.env.VITE_FLASK_TARGET || 'http://localhost:5000';
  return {
  plugins: [react()],
  // Reuse the existing product assets while the legacy frontend is still present.
  publicDir: '../public',
  server: {
    proxy: {
      '/api/auth': { target: flaskBackend, changeOrigin: true },
      '/api/admin/floor-plans': { target: flaskBackend, changeOrigin: true },
      '/api': { target: backend, changeOrigin: true },
      '/labels': { target: backend, changeOrigin: true },
      '/healthz': { target: backend, changeOrigin: true },
    },
  },
  };
});

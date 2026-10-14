import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = process.env.VITE_DEV_API_TARGET ?? 'http://localhost:3000';
const flaskBackend = process.env.VITE_FLASK_TARGET ?? 'http://localhost:5000';

export default defineConfig({
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
});

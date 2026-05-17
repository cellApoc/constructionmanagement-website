import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In production, VITE_API_URL points to your Elastic Beanstalk backend.
// In development, the proxy forwards /api requests to localhost:3001.
const apiUrl = process.env.VITE_API_URL || 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  // For Cloudflare Pages: all API calls go to the full backend URL
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify(apiUrl),
  },
});

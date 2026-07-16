import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type ProxyOptions } from 'vite';

const apiProxy: Record<string, ProxyOptions> = {
  '/api': {
    target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000',
    changeOrigin: false,
  },
};

// The dev server proxies /api to the local API process; production serves the
// static build behind a reverse proxy (the Vite dev server is never used in
// production — ADR 0007). The preview server proxies too so Playwright can
// exercise real API flows against the production build.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    proxy: apiProxy,
  },
  preview: {
    port: 4173,
    proxy: apiProxy,
  },
});

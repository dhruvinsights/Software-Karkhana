import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const api = process.env.API_URL ?? 'http://localhost:8080';

export default defineConfig({
  envDir: '..',
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // Stable vendor chunks cache across deploys; icons in one chunk instead of
        // dozens of tiny per-icon requests from the lazy-loaded views.
        manualChunks: {
          motion: ['motion/react'],
          react: ['react', 'react-dom', 'react-dom/client'],
          icons: ['lucide-react'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': api, '/healthz': api },
  },
});

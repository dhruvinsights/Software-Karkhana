import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const api = process.env.API_URL ?? 'http://localhost:8080';

export default defineConfig({
  envDir: '..',
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: { output: { manualChunks: { motion: ['motion/react'] } } },
  },
  server: {
    port: 5173,
    proxy: { '/api': api, '/healthz': api },
  },
});

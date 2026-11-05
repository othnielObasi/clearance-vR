import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

// WebXR needs a secure context, so the dev server runs on HTTPS for headset testing on your LAN.
// GitHub Pages serves from /<repo>/; the deploy workflow sets BASE accordingly.
export default defineConfig(({ command }) => ({
  base: process.env.BASE ?? './',
  plugins: command === 'serve' ? [basicSsl()] : [],
  server: { host: true },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 8000 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
}));

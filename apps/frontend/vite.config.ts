import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Vite and Vitest share one compatible Vite 6 dependency; no unsafe type casts.
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 15173, strictPort: true },
  preview: { host: '127.0.0.1', port: 15173, strictPort: true },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.test.{ts,tsx}'],
    css: true,
    api: false,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});

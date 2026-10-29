import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';

// Vite and Vitest share one compatible Vite 6 dependency; no unsafe type casts.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'UAPM_');
  const target = process.env.UAPM_DEV_API_TARGET || env.UAPM_DEV_API_TARGET;
  if (target) {
    const url = new URL(target);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) {
      throw new Error('UAPM_DEV_API_TARGET must be an unauthenticated loopback HTTP origin.');
    }
  }
  // Same origin exposes Retry-After to browser JS without changing the backend CORS/security policy.
  // Browser cookies and Origin pass through unchanged; rate limits and identities are not bypassed.
  const proxy = target ? { '/api': { target, changeOrigin: false } } : undefined;
  return {
  plugins: [react()],
  server: { host: '127.0.0.1', port: 15173, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: 15173, strictPort: true, proxy },
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
};
});

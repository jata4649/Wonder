import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: true },
  test: { environment: 'node' },
} as any);

import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: true,
    // 開発時はオンライン対戦のサーバー（npm run server）へプロキシ
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
  test: { environment: 'node' },
} as any);

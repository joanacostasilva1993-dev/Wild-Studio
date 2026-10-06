// Licensed under the Business Source License 1.1 — see LICENSE-DRAFT.md

/**
 * Configuração do Vite para a UI web do Wild Studio (M3).
 *
 * - `root: 'ui'`: todo o código da UI vive em `ui/` (contrato M3);
 * - em produção (`vite build`), o resultado vai para `public/` na raiz do
 *   repo, servido pela API local;
 * - em desenvolvimento, o Vite corre na porta 5173 e encaminha `/api`
 *   para a API local (`http://localhost:3000`).
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'ui',
  plugins: [react()],
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});

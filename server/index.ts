// Licensed under the Business Source License 1.1 — see LICENSE

/**
 * Ponto de entrada da API local.
 *
 * Arranca o Express em `localhost`, monta o router da API (`src/api`) e
 * abre a base de dados SQLite. Sem autenticação: destina-se a uso local (MVP).
 *
 * Variáveis de ambiente:
 * - `PORT` — porta de escuta (por omissão 3000);
 * - `DB_PATH` — caminho do ficheiro SQLite (por omissão `./dados.db`);
 * - `EXT_DIR` — diretório das extensões instaladas (por omissão `./extensoes`).
 */

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { abrirBanco } from '../src/db/index.js';
import { criarRouter } from '../src/api/routes.js';
import { RegistoExtensoes } from '../src/extensoes/registo.js';

const porta = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(porta) || porta <= 0 || porta > 65535) {
  console.error(`PORT inválido: '${process.env.PORT}'.`);
  process.exit(1);
}

const caminhoBanco = process.env.DB_PATH ?? './dados.db';
const dirExtensoes = process.env.EXT_DIR ?? './extensoes';
const banco = abrirBanco(caminhoBanco);
const registo = new RegistoExtensoes(banco);

const app = express();
app.use(express.json());
app.use(criarRouter(banco, registo, { dirExtensoes }));

// ── UI em produção (M3) ─────────────────────────────────────────────
// A pasta `public/` é a saída do build da UI (`vite build`, com `root:
// 'ui'` e `outDir: '../public'`, resolvida a partir de `process.cwd()`
// para funcionar tanto com `tsx server/index.ts` como com
// `node dist/server/index.js` corridos da raiz). As rotas `/api/*` estão
// montadas acima e mantêm prioridade sobre o estático; qualquer outra
// rota GET serve `public/index.html` (navegação da SPA).
const dirPublico = path.resolve(process.cwd(), 'public');
const existePublico = fs.existsSync(dirPublico) && fs.statSync(dirPublico).isDirectory();
if (existePublico) {
  app.use(express.static(dirPublico));
  app.get('*', (req, res, next) => {
    // Um `/api/*` GET desconhecido continua a ser 404 da API — nunca a SPA.
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(path.join(dirPublico, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.json({ erro: 'UI não construída — corre npm run build' });
  });
}

const servidor = app.listen(porta, () => {
  console.log(`API local em http://localhost:${porta}`);
});

servidor.on('error', (erro: unknown) => {
  console.error('Falha ao arrancar a API:', erro instanceof Error ? erro.message : erro);
  banco.fechar();
  process.exit(1);
});

let aEncerrar = false;

/** Encerra o servidor HTTP e fecha a base de dados com elegância. */
function encerrar(sinal: string): void {
  if (aEncerrar) {
    return;
  }
  aEncerrar = true;
  console.log(`\n${sinal} recebido — a encerrar a API...`);
  servidor.close(() => {
    banco.fechar();
    console.log('Base de dados fechada. Até já.');
    process.exit(0);
  });
  // Rede de segurança: se o servidor não fechar, força a saída.
  setTimeout(() => {
    try {
      banco.fechar();
    } catch {
      // A base já estava fechada; nada a fazer.
    }
    process.exit(0);
  }, 5000).unref();
}

process.on('SIGINT', () => encerrar('SIGINT'));
process.on('SIGTERM', () => encerrar('SIGTERM'));

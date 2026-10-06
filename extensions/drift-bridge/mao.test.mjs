// Licensed under the Business Source License 1.1 — see ../../LICENSE-DRAFT.md

/**
 * Testes da extensão "Ponte Drift" (drift-bridge).
 *
 * Corre com `node --test extensions/drift-bridge/mao.test.mjs`
 * (não entra no `npm test`, que só corre `src/**`).
 *
 * Usa um **servidor MCP falso** em localhost que emula o comportamento
 * documentado do Drift (handshake `initialize`, `tools/call` com
 * `{ok:false, error, detail}`, `export_video` assíncrono). O `mao.js`
 * é exercitado de ponta a ponta contra esse duplo — incluindo a
 * descoberta de operações via `catalog` e o mapeamento de erros.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executar } from './mao.js';

/* ------------------------------------------------------------------ */
/* Servidor MCP falso                                                 */
/* ------------------------------------------------------------------ */

const FERRAMENTAS_BASE = [
  'catalog', 'search', 'toolbox', 'apply', 'inspect',
  'import_media', 'export_video', 'export_status',
  'place_clip', 'add_audio_clip', 'import_subtitles', 'add_text', 'add_transition',
];

const SCHEMAS_BASE = {
  place_clip: { properties: { asset: {}, track: {}, start: {}, duration: {} } },
  add_audio_clip: { properties: { asset: {}, track: {}, start: {} } },
  import_subtitles: { properties: { asset: {}, track: {} } },
  add_text: { properties: { text: {}, track: {}, start: {}, duration: {} } },
  add_transition: { properties: { transition: {}, entre: {} } },
};

/** Escreve um "MP4" mínimo: 12 bytes com assinatura `ftyp` no offset 4. */
function escreverMp4Falso(caminho, vazio = false) {
  if (vazio) {
    writeFileSync(caminho, Buffer.alloc(0));
    return;
  }
  const buf = Buffer.alloc(64);
  buf.writeUInt32BE(16, 0);
  buf.write('ftyp', 4, 'ascii');
  buf.write('isom', 8, 'ascii');
  writeFileSync(caminho, buf);
}

function criarServidor(cenario = {}) {
  const cfg = {
    versao: '0.7.5',
    ferramentas: [...FERRAMENTAS_BASE],
    falhaImportar: null, // { error, detail }
    falhaAplicar: null, // { stopped, tool }
    exportBusy: false,
    exportVazio: false,
    ...cenario,
  };
  const registos = { chamadas: [], aplicacoes: [], colocacoes: [] };
  let idPedido = 1;
  let exportacoesAtivas = 0;

  const payload = (obj) => ({ jsonrpc: '2.0', id: idPedido, result: { content: [{ type: 'text', text: JSON.stringify(obj) }] } });

  const servidor = createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      let msg;
      try {
        msg = JSON.parse(corpo);
      } catch {
        res.writeHead(400).end('{}');
        return;
      }
      idPedido = msg.id ?? idPedido;
      const { method, params } = msg;

      const responder = (obj) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload(obj)));
      };

      if (method === 'initialize') {
        return responder({
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'drift-fake', version: cfg.versao },
          instructions: 'fake',
        });
      }
      if (method === 'notifications/initialized') {
        return responder({});
      }
      if (method !== 'tools/call') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } }));
      }

      const nome = params?.name;
      const args = params?.arguments ?? {};
      registos.chamadas.push(nome);

      switch (nome) {
        case 'catalog':
          return responder({ ok: true, tools: cfg.ferramentas.map((n) => ({ name: n, toolbox: 'nucleo', when: `quando precisares de ${n}` })) });
        case 'search': {
          const q = String(args.q ?? '').toLowerCase();
          const hits = cfg.ferramentas.filter((n) => n.toLowerCase().includes(q)).map((n) => ({ name: n, toolbox: 'nucleo', when: '' }));
          return responder({ ok: true, hits });
        }
        case 'toolbox': {
          const ops = args.ops ?? (args.name ? [args.name] : []);
          const schemas = {};
          for (const op of ops) schemas[op] = SCHEMAS_BASE[op] ?? { properties: {} };
          return responder({ ok: true, schemas });
        }
        case 'import_media': {
          if (cfg.falhaImportar) {
            return responder({ ok: false, error: cfg.falhaImportar.error, detail: cfg.falhaImportar.detail });
          }
          const caminhos = args.paths ?? [];
          return responder({
            ok: true,
            importados: caminhos.map((c, i) => ({ id: `asset-${i}`, caminho: c })),
            missing: [],
          });
        }
        case 'apply': {
          const ops = args.ops ?? [];
          if (cfg.falhaAplicar) {
            return responder({
              ok: false, error: 'apply_failed', stopped: cfg.falhaAplicar.stopped ?? 0,
              tool: cfg.falhaAplicar.tool ?? ops[0]?.tool, failed: { error: 'bad_args' }, done: [],
            });
          }
          registos.aplicacoes.push(ops);
          for (const op of ops) {
            if (['place_clip', 'add_audio_clip', 'import_subtitles', 'add_text'].includes(op.tool)) {
              registos.colocacoes.push(op);
            }
          }
          return responder({ ok: true, aplicados: ops.length });
        }
        case 'inspect':
          return responder({
            ok: true, revision: registos.aplicacoes.length + 1,
            clips: registos.colocacoes.map((op, i) => ({ id: `clip-${i}`, faixa: op.args?.track ?? 0 })),
          });
        case 'export_video': {
          if (cfg.exportBusy) {
            return responder({ ok: false, error: 'export_busy', detail: 'outra exportação em curso' });
          }
          const caminho = args.path ?? join(tmpdir(), 'drift-fake.mp4');
          escreverMp4Falso(caminho, cfg.exportVazio);
          exportacoesAtivas++;
          return responder({ ok: true, started: true, path: caminho });
        }
        case 'export_status': {
          if (exportacoesAtivas > 0) {
            exportacoesAtivas--;
            return responder({ ok: true, active: true, progress: 0.5 });
          }
          return responder({ ok: true, active: false, ok2: true });
        }
        default:
          return responder({ ok: false, error: 'unknown_op', detail: `operação desconhecida: ${nome}` });
      }
    });
  });

  return new Promise((resolver) => {
    servidor.listen(0, '127.0.0.1', () => {
      resolver({
        porta: servidor.address().port,
        registos,
        fechar: () => new Promise((r) => servidor.close(r)),
      });
    });
  });
}

/* ------------------------------------------------------------------ */
/* Utilidades de teste                                                */
/* ------------------------------------------------------------------ */

let dirTmp = null;
const ENVS = ['DRIFT_BRIDGE_SEM_LANCAR', 'DRIFT_MCP_PORT', 'DRIFT_BRIDGE_INTERVALO_POLL_MS', 'DRIFT_PATH'];
const envGuardado = {};

beforeEach(() => {
  for (const k of ENVS) envGuardado[k] = process.env[k];
  process.env.DRIFT_BRIDGE_SEM_LANCAR = '1';
  process.env.DRIFT_BRIDGE_INTERVALO_POLL_MS = '10';
  dirTmp = mkdtempSync(join(tmpdir(), 'drift-bridge-test-'));
});

afterEach(() => {
  for (const k of ENVS) {
    if (envGuardado[k] === undefined) delete process.env[k];
    else process.env[k] = envGuardado[k];
  }
  if (dirTmp && existsSync(dirTmp)) rmSync(dirTmp, { recursive: true, force: true });
  dirTmp = null;
});

function ficheiro(nome, conteudo = 'x') {
  const caminho = join(dirTmp, nome);
  writeFileSync(caminho, conteudo);
  return caminho;
}

function pedidoBase(sobrescritas = {}) {
  return {
    capacidadeId: 'montar-e-exportar',
    extensaoId: 'wild-studio.drift-bridge',
    bloco: { id: 'b1', tipo: 'CRIAR', processo: 'edicao', titulo: 'Montar vídeo', parametros: {} },
    entradas: {},
    saidasDeclaradas: [],
    efeitosDeclarados: ['execucao_local'],
    ...sobrescritas,
  };
}

/* ------------------------------------------------------------------ */
/* Testes                                                             */
/* ------------------------------------------------------------------ */

test('fluxo completo: monta timeline e exporta MP4', async () => {
  const fake = await criarServidor();
  process.env.DRIFT_MCP_PORT = String(fake.porta);
  try {
    const narracao = ficheiro('narracao.mp3');
    const c1 = ficheiro('cena1.mp4');
    const c2 = ficheiro('cena2.mp4');
    const srt = ficheiro('leg.srt', '1\n00:00:00,000 --> 00:00:01,000\nOlá\n');
    const resposta = await executar(pedidoBase({
      bloco: { id: 'b1', tipo: 'CRIAR', processo: 'edicao', titulo: 'Montar', parametros: { transicao: 'fade' } },
      entradas: {
        narracao: { id: narracao },
        clips: [{ id: c1 }, { id: c2 }],
        legendas: { id: srt },
        titulo: 'O meu vídeo',
      },
    }));

    const videoFinal = resposta.saidas.video_final;
    assert.ok(videoFinal && typeof videoFinal.id === 'string');
    assert.ok(videoFinal.id.endsWith('.mp4'), `esperado .mp4, obtido ${videoFinal.id}`);
    assert.ok(existsSync(videoFinal.id), 'MP4 exportado não existe');

    // Sequência de operações esperada.
    assert.ok(fake.registos.chamadas.includes('import_media'), 'import_media não foi chamado');
    assert.ok(fake.registos.chamadas.includes('export_video'), 'export_video não foi chamado');
    const colocacoes = fake.registos.colocacoes.map((op) => op.tool);
    assert.deepEqual(
      colocacoes,
      ['place_clip', 'place_clip', 'add_audio_clip', 'import_subtitles', 'add_text'],
      `colocações inesperadas: ${JSON.stringify(colocacoes)}`,
    );
    // O lote de vídeo colocou os dois clips na faixa 0 com inícios sequenciais.
    const clipsColocados = fake.registos.colocacoes.filter((op) => op.tool === 'place_clip');
    assert.equal(clipsColocados[0].args.track, 0);
    assert.equal(clipsColocados[0].args.start, 0);
    assert.equal(clipsColocados[1].args.start, 3, 'segundo clip devia começar aos 3s (duração de cena omissa)');
    // Transição pedida → lote de transições aplicado.
    const temTransicao = fake.registos.aplicacoes.some((lote) =>
      lote.some((op) => op.tool === 'add_transition'),
    );
    assert.ok(temTransicao, 'transição fade não foi aplicada');
  } finally {
    await fake.fechar();
  }
});

test('artefactos como string e { caminho } também são aceites', async () => {
  const fake = await criarServidor();
  process.env.DRIFT_MCP_PORT = String(fake.porta);
  try {
    const c1 = ficheiro('a.mp4');
    const resposta = await executar(pedidoBase({
      entradas: { narracao: c1, clips: [{ caminho: c1 }] },
    }));
    assert.ok(existsSync(resposta.saidas.video_final.id));
  } finally {
    await fake.fechar();
  }
});

test('import_failed → erro claro (sem retry útil)', async () => {
  const fake = await criarServidor({ falhaImportar: { error: 'import_failed', detail: 'codec não suportado' } });
  process.env.DRIFT_MCP_PORT = String(fake.porta);
  try {
    const c1 = ficheiro('a.mp4');
    await assert.rejects(
      () => executar(pedidoBase({ entradas: { clips: [{ id: c1 }] } })),
      /import_failed/,
    );
  } finally {
    await fake.fechar();
  }
});

test('operação de colocação ausente no catálogo → falha explícita', async () => {
  const fake = await criarServidor({
    ferramentas: ['catalog', 'search', 'toolbox', 'apply', 'inspect', 'import_media', 'export_video', 'export_status'],
  });
  process.env.DRIFT_MCP_PORT = String(fake.porta);
  try {
    const c1 = ficheiro('a.mp4');
    await assert.rejects(
      () => executar(pedidoBase({ entradas: { clips: [{ id: c1 }] } })),
      /não encontradas no catálogo/,
    );
  } finally {
    await fake.fechar();
  }
});

test('legendas sem operação no catálogo → falha explícita (não omite em silêncio)', async () => {
  const fake = await criarServidor({
    ferramentas: ['catalog', 'search', 'toolbox', 'apply', 'inspect', 'import_media', 'export_video', 'export_status', 'place_clip'],
  });
  process.env.DRIFT_MCP_PORT = String(fake.porta);
  try {
    const c1 = ficheiro('a.mp4');
    const srt = ficheiro('leg.srt', 'x');
    await assert.rejects(
      () => executar(pedidoBase({ entradas: { clips: [{ id: c1 }], legendas: { id: srt } } })),
      /legendas/,
    );
  } finally {
    await fake.fechar();
  }
});

test('export_busy → erro transitório (o executor faz retry)', async () => {
  const fake = await criarServidor({ exportBusy: true });
  process.env.DRIFT_MCP_PORT = String(fake.porta);
  try {
    const c1 = ficheiro('a.mp4');
    const erro = await executar(pedidoBase({ entradas: { clips: [{ id: c1 }] } })).then(
      () => null,
      (e) => e,
    );
    assert.ok(erro, 'devia ter lançado erro');
    assert.match(erro.message, /export_busy/);
    assert.equal(erro.name, 'ErroDrift', 'export_busy deve chegar como ErroDrift (transitório)');
  } finally {
    await fake.fechar();
  }
});

test('apply_failed parcial → erro com índice de paragem', async () => {
  const fake = await criarServidor({ falhaAplicar: { stopped: 1, tool: 'place_clip' } });
  process.env.DRIFT_MCP_PORT = String(fake.porta);
  try {
    const c1 = ficheiro('a.mp4');
    await assert.rejects(
      () => executar(pedidoBase({ entradas: { clips: [{ id: c1 }] } })),
      /transitória/,
    );
  } finally {
    await fake.fechar();
  }
});

test('versão major incompatível → recusa imediata', async () => {
  const fake = await criarServidor({ versao: '1.0.0' });
  process.env.DRIFT_MCP_PORT = String(fake.porta);
  try {
    const c1 = ficheiro('a.mp4');
    await assert.rejects(
      () => executar(pedidoBase({ entradas: { clips: [{ id: c1 }] } })),
      /incompatível/,
    );
  } finally {
    await fake.fechar();
  }
});

test('MP4 vazio → falha na validação (nunca finge sucesso)', async () => {
  const fake = await criarServidor({ exportVazio: true });
  process.env.DRIFT_MCP_PORT = String(fake.porta);
  try {
    const c1 = ficheiro('a.mp4');
    await assert.rejects(
      () => executar(pedidoBase({ entradas: { clips: [{ id: c1 }] } })),
      /vazio/,
    );
  } finally {
    await fake.fechar();
  }
});

test('drift_path inexistente (sem SEM_LANCAR) → erro de configuração', async () => {
  delete process.env.DRIFT_BRIDGE_SEM_LANCAR;
  process.env.DRIFT_PATH = join(dirTmp, 'drift-que-nao-existe');
  const c1 = ficheiro('a.mp4');
  await assert.rejects(
    () => executar(pedidoBase({ entradas: { clips: [{ id: c1 }] } })),
    /não respondeu|falhou ao arrancar|não foi possível lançar/,
  );
});

test('sem clips → erro de configuração antes de qualquer rede', async () => {
  const fake = await criarServidor();
  process.env.DRIFT_MCP_PORT = String(fake.porta);
  try {
    await assert.rejects(
      () => executar(pedidoBase({ entradas: {} })),
      /nenhum artefacto/,
    );
    assert.ok(!fake.registos.chamadas.includes('import_media'), 'não devia ter chamado a rede');
  } finally {
    await fake.fechar();
  }
});

// Licensed under the Business Source License 1.1 — see LICENSE

/**
 * Testes de integração da API de extensões (M2).
 *
 * Arranca o Express in-process (`criarRouter` + `abrirBanco(':memory:')`) em
 * `127.0.0.1` com porta efémera e testa por HTTP com os módulos REAIS dos
 * colegas (`RegistoExtensoes` e `executarJobsPendentes`):
 * - instalar → obter → listar → consentir → remover (e erros 400/404/409);
 * - a ponte real do executor (`criarDepsExecutor`: resolverCapacidade via
 *   registo + `import()` dinâmico do `mao.js`);
 * - fluxo completo via API com uma extensão mock mínima criada em pasta
 *   temporária: o bloco `ia` executa e a entrega é validada contra a porta
 *   declarada;
 * - resposta inválida da extensão → bloco `falhou` com diagnóstico;
 * - extensão inexistente → bloco `falhou`; o diagnóstico menciona o id
 *   (erro de configuração, sem retry);
 * - `GET /api/jobs/pendentes`, `POST /api/jobs/:id/repetir` (404 se
 *   inexistente);
 * - degradação honesta: rotas de extensões sem registo → 503.
 *
 * O executor cria um temporizador de timeout por invocação; nos testes
 * injeta-se um `dormir` com `unref` para não segurar o event loop.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { abrirBanco, type Banco } from '../db/index.js';
import { criarRouter, type OpcoesRouter } from './routes.js';
import { RegistoExtensoes } from '../extensoes/registo.js';
import { criarDepsExecutor, type DepsExecutor } from './extensoes.js';
import type { ResumoExecucao } from '../engine/executor.js';

const PROCESSOS = [
  'tema',
  'titulo',
  'thumbnail',
  'guiao',
  'narracao',
  'visuais',
  'edicao',
  'publicacao',
];

const FIXTURE_ID = 'teste.extensao-mock';

/* ------------------------------------------------------------------ */
/* Infraestrutura de teste                                            */
/* ------------------------------------------------------------------ */

interface AppTeste {
  base: string;
  banco: Banco;
  registo: RegistoExtensoes;
  fechar: () => Promise<void>;
}

/**
 * `dormir` para os testes: temporizador real mas com `unref`, para o
 * timeout do executor não segurar o event loop após os testes.
 */
function dormirTeste(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const temporizador = setTimeout(resolve, ms);
    (temporizador as unknown as { unref?: () => void }).unref?.();
  });
}

async function criarApp(opcoes: OpcoesRouter = {}): Promise<AppTeste> {
  const banco = abrirBanco(':memory:');
  const registo = new RegistoExtensoes(banco);
  const dirExtensoes = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ws-ext-'));
  const app = express();
  app.use(express.json());
  app.use(
    criarRouter(banco, registo, {
      dirExtensoes,
      executarOpcoes: { dormir: dormirTeste },
      ...opcoes,
    }),
  );
  const servidor = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = servidor.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    banco,
    registo,
    fechar: async () => {
      await new Promise<void>((resolve) => servidor.close(() => resolve()));
      banco.fechar();
      await fs.promises.rm(dirExtensoes, { recursive: true, force: true });
    },
  };
}

/** Corpo JSON de resposta da API (forma livre; `any` intencional nos testes). */
type CorpoApi = any;

async function api(
  base: string,
  metodo: string,
  caminho: string,
  corpo?: unknown,
): Promise<{ estado: number; dados: CorpoApi }> {
  const resposta = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  let dados: CorpoApi = null;
  try {
    dados = (await resposta.json()) as CorpoApi;
  } catch {
    // Corpo vazio ou não-JSON.
  }
  return { estado: resposta.status, dados };
}

/** Garante que a promessa rejeita com mensagem que contém o texto (case-insensitive). */
async function rejeitaCom(promessa: Promise<unknown>, texto: string): Promise<void> {
  let erro: unknown;
  try {
    await promessa;
  } catch (e) {
    erro = e;
  }
  assert.ok(erro instanceof Error, 'esperava que a promessa rejeitasse');
  assert.ok(
    erro.message.toLowerCase().includes(texto.toLowerCase()),
    `a mensagem "${erro.message}" devia conter "${texto}"`,
  );
}

/* ------------------------------------------------------------------ */
/* Extensão mock mínima (pasta temporária)                             */
/* ------------------------------------------------------------------ */

/**
 * Cria uma extensão mock mínima numa pasta temporária: `extensao.json` +
 * `mao.js` (sem dependências). Variante `ok` devolve saidas fixas válidas;
 * `saida-invalida` devolve um valor que viola a porta declarada.
 */
async function criarFixture(dir: string, variante: 'ok' | 'saida-invalida'): Promise<string> {
  const origem = await fs.promises.mkdtemp(path.join(dir, 'fixture-'));
  await fs.promises.writeFile(
    path.join(origem, 'package.json'),
    JSON.stringify({ type: 'module' }),
  );
  const mao =
    variante === 'ok'
      ? 'export async function executar() {\n' +
        "  return { saidas: { resposta: ['fixo-1', 'fixo-2'] } };\n" +
        '}\n'
      : 'export async function executar() {\n' +
        "  return { saidas: { resposta: 'não-é-uma-lista' } };\n" +
        '}\n';
  await fs.promises.writeFile(path.join(origem, 'mao.js'), mao);
  const manifesto = {
    apiVersion: '1',
    id: FIXTURE_ID,
    nome: 'Extensão Mock de Teste',
    versao: '0.0.1',
    autor: 'testes',
    licenca: 'BSL-1.1',
    runtime: { tipo: 'modulo', entrada: 'mao.js', exportacao: 'executar' },
    capacidades: [
      {
        id: 'cap-mock',
        operador: 'ia',
        blocosCompativeis: ['CRIAR'],
        processosCompativeis: ['titulo'],
        entradas: [],
        saidas: [
          {
            chave: 'resposta',
            rotulo: 'Resposta',
            tipo: {
              tipo: 'conteudo',
              familia: 'texto',
              cardinalidade: 'varios',
              representacao: 'embutido',
            },
          },
        ],
        efeitos: [],
        custo: { modelo: 'gratuito', descricao: 'mock de teste' },
        politicaDados: {
          enviaParaTerceiros: false,
          fornecedores: [],
          descricao: 'mock local, sem rede',
        },
      },
    ],
  };
  await fs.promises.writeFile(
    path.join(origem, 'extensao.json'),
    JSON.stringify(manifesto, null, 2),
  );
  return origem;
}

function portaResposta(chave = 'resposta') {
  return {
    chave,
    rotulo: 'Resposta',
    tipo: {
      tipo: 'conteudo',
      familia: 'texto',
      cardinalidade: 'varios',
      representacao: 'embutido',
    },
  };
}

function metodoHumano(processo: string) {
  return {
    processo,
    blocos: [
      {
        id: `${processo}-h`,
        tipo: 'CRIAR',
        operador: 'humano',
        titulo: `Criar ${processo}`,
      },
    ],
  };
}

async function instalarEConsentir(base: string, caminho: string, id: string): Promise<void> {
  let r = await api(base, 'POST', '/api/extensoes/instalar', { caminho });
  assert.equal(r.estado, 201, JSON.stringify(r.dados));
  assert.equal(r.dados.id, id);
  r = await api(base, 'POST', `/api/extensoes/${id}/consentir`, { consentido: true });
  assert.equal(r.estado, 200, JSON.stringify(r.dados));
}

async function registarCanalComIa(
  base: string,
  nome: string,
  ordem: string[],
  extensaoId: string,
  blocoIaId = 't-ia',
): Promise<number> {
  let r = await api(base, 'POST', '/api/canais', { nome, ordemProcessos: ordem });
  assert.equal(r.estado, 201);
  const canalId: number = r.dados.id;
  for (const processo of ordem) {
    const metodo =
      processo === 'titulo'
        ? {
            processo,
            blocos: [
              {
                id: blocoIaId,
                tipo: 'CRIAR',
                operador: 'ia',
                titulo: 'Gerar com IA',
                extensaoId,
                parametros: { tema: 'tema de teste' },
                saidas: [portaResposta()],
              },
            ],
          }
        : metodoHumano(processo);
    r = await api(base, 'PUT', `/api/canais/${canalId}/metodos`, metodo);
    assert.equal(r.estado, 200, `PUT metodos/${processo}: ${JSON.stringify(r.dados)}`);
  }
  return canalId;
}

function blocosDe(detalhe: { processos: { blocos: CorpoApi[] }[] }): CorpoApi[] {
  return detalhe.processos.flatMap((p) => p.blocos);
}

/* ------------------------------------------------------------------ */
/* Testes                                                             */
/* ------------------------------------------------------------------ */

test('extensões: instalar → obter → listar → consentir → remover', async () => {
  const app = await criarApp();
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ws-fixture-'));
  try {
    const origem = await criarFixture(tmp, 'ok');

    let r = await api(app.base, 'POST', '/api/extensoes/instalar', { caminho: origem });
    assert.equal(r.estado, 201, JSON.stringify(r.dados));
    assert.equal(r.dados.id, FIXTURE_ID);
    assert.equal(r.dados.ativa, false);
    assert.ok(typeof r.dados.resumo === 'object' && r.dados.resumo.id === FIXTURE_ID);
    assert.ok(typeof r.dados.nota === 'string' && r.dados.nota.length > 0);

    r = await api(app.base, 'POST', '/api/extensoes/instalar', { caminho: origem });
    assert.equal(r.estado, 409);

    r = await api(app.base, 'POST', '/api/extensoes/instalar', {
      caminho: path.join(tmp, 'nao-existe'),
    });
    assert.equal(r.estado, 400);

    const vazio = await fs.promises.mkdtemp(path.join(tmp, 'vazio-'));
    r = await api(app.base, 'POST', '/api/extensoes/instalar', { caminho: vazio });
    assert.equal(r.estado, 400);

    r = await api(app.base, 'GET', '/api/extensoes');
    assert.equal(r.estado, 200);
    assert.equal(r.dados.length, 1);
    assert.equal(r.dados[0].id, FIXTURE_ID);
    assert.equal(r.dados[0].ativa, false);
    assert.equal(r.dados[0].capacidades, 1);

    r = await api(app.base, 'GET', '/api/extensoes/nao.existe');
    assert.equal(r.estado, 404);

    r = await api(app.base, 'GET', `/api/extensoes/${FIXTURE_ID}`);
    assert.equal(r.estado, 200);
    assert.equal(r.dados.capacidades.length, 1);
    assert.equal(r.dados.capacidades[0].id, 'cap-mock');
    assert.equal(r.dados.ativa, false);
    assert.ok(typeof r.dados.caminho === 'string');

    r = await api(app.base, 'POST', `/api/extensoes/${FIXTURE_ID}/consentir`, {});
    assert.equal(r.estado, 400);

    r = await api(app.base, 'POST', `/api/extensoes/${FIXTURE_ID}/consentir`, {
      consentido: true,
      nota: 'teste',
    });
    assert.equal(r.estado, 200);
    assert.deepEqual(r.dados, { id: FIXTURE_ID, ativa: true });

    r = await api(app.base, 'POST', `/api/extensoes/${FIXTURE_ID}/consentir`, {
      consentido: false,
    });
    assert.deepEqual(r.dados, { id: FIXTURE_ID, ativa: false });

    r = await api(app.base, 'POST', '/api/extensoes/nao.existe/consentir', {
      consentido: true,
    });
    assert.equal(r.estado, 404);

    r = await api(app.base, 'DELETE', `/api/extensoes/${FIXTURE_ID}`);
    assert.equal(r.estado, 200);
    assert.deepEqual(r.dados, { removida: true });

    r = await api(app.base, 'DELETE', `/api/extensoes/${FIXTURE_ID}`);
    assert.equal(r.estado, 404);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
    await app.fechar();
  }
});

test('ponte do executor: resolverCapacidade + carregarModulo (reais)', async () => {
  const app = await criarApp();
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ws-fixture-'));
  try {
    const origem = await criarFixture(tmp, 'ok');
    await instalarEConsentir(app.base, origem, FIXTURE_ID);

    const deps: DepsExecutor = criarDepsExecutor(app.registo);
    const resolvida = await deps.resolverCapacidade(FIXTURE_ID, {
      operador: 'ia',
      tipoBloco: 'CRIAR',
      processo: 'titulo',
    });
    assert.equal(resolvida.extensaoId, FIXTURE_ID);
    assert.equal(resolvida.capacidadeId, 'cap-mock');
    assert.ok(
      resolvida.moduloCaminho.endsWith(path.join(FIXTURE_ID, 'mao.js')),
      resolvida.moduloCaminho,
    );
    assert.equal(resolvida.saidas.length, 1);
    assert.equal(resolvida.saidas[0].chave, 'resposta');

    const modulo = await deps.carregarModulo(resolvida.moduloCaminho);
    assert.equal(typeof modulo.executar, 'function');
    const resposta = await modulo.executar({
      capacidadeId: 'cap-mock',
      extensaoId: FIXTURE_ID,
      bloco: { id: 't-ia', tipo: 'CRIAR', processo: 'titulo', titulo: 'Gerar' },
      entradas: {},
      saidasDeclaradas: [],
      efeitosDeclarados: [],
    });
    assert.deepEqual(resposta, { saidas: { resposta: ['fixo-1', 'fixo-2'] } });

    // Extensão inativa → resolverCapacidade lança.
    const r = await api(app.base, 'POST', `/api/extensoes/${FIXTURE_ID}/consentir`, {
      consentido: false,
    });
    assert.equal(r.estado, 200);
    await rejeitaCom(
      Promise.resolve(
        deps.resolverCapacidade(FIXTURE_ID, {
          operador: 'ia',
          tipoBloco: 'CRIAR',
          processo: 'titulo',
        }),
      ),
      'inativa',
    );

    // Extensão inexistente → lança com o id no diagnóstico.
    await rejeitaCom(
      Promise.resolve(
        deps.resolverCapacidade('extensao.inexistente', {
          operador: 'ia',
          tipoBloco: 'CRIAR',
          processo: 'titulo',
        }),
      ),
      'extensao.inexistente',
    );
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
    await app.fechar();
  }
});

test('fluxo completo via API: bloco ia executa; entrega validada contra a porta', async () => {
  const app = await criarApp();
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ws-fixture-'));
  try {
    const origem = await criarFixture(tmp, 'ok');
    await instalarEConsentir(app.base, origem, FIXTURE_ID);

    const canalId = await registarCanalComIa(app.base, 'Canal IA', PROCESSOS, FIXTURE_ID);
    let r = await api(app.base, 'POST', '/api/projetos', { canalId, nome: 'P1' });
    assert.equal(r.estado, 201);
    const projetoId: number = r.dados.id;

    // O primeiro processo é 'tema' (humano): entrega manual, depois o ia.
    r = await api(app.base, 'POST', `/api/projetos/${projetoId}/avancar`);
    assert.equal(r.estado, 200);
    let detalhe = (await api(app.base, 'GET', `/api/projetos/${projetoId}`)).dados;
    const blocoTema = blocosDe(detalhe).find((b) => b.blocoId === 'tema-h');
    assert.equal(blocoTema.estado, 'em_curso');
    r = await api(app.base, 'POST', `/api/blocos/${blocoTema.id}/entrega`, {
      valor: 'tema manual',
    });
    assert.equal(r.estado, 200);

    r = await api(app.base, 'POST', `/api/projetos/${projetoId}/avancar`);
    assert.equal(r.estado, 200);
    detalhe = (await api(app.base, 'GET', `/api/projetos/${projetoId}`)).dados;
    const blocoIa = blocosDe(detalhe).find((b) => b.blocoId === 't-ia');
    assert.equal(blocoIa.estado, 'em_curso');

    r = await api(app.base, 'POST', '/api/jobs/executar', {});
    assert.equal(r.estado, 200, JSON.stringify(r.dados));
    const resumo = r.dados as ResumoExecucao;
    assert.equal(resumo.executados, 1);
    assert.equal(resumo.concluidos, 1);
    assert.equal(resumo.falhados, 0);

    detalhe = (await api(app.base, 'GET', `/api/projetos/${projetoId}`)).dados;
    const blocoIaDepois = blocosDe(detalhe).find((b) => b.blocoId === 't-ia');
    assert.equal(blocoIaDepois.estado, 'concluido');

    const entregas = (await api(app.base, 'GET', `/api/projetos/${projetoId}/entregas`))
      .dados as { execBlocoId: number; valor: unknown }[];
    const entrega = entregas.find((e) => e.execBlocoId === blocoIaDepois.id);
    assert.ok(entrega, 'esperava uma entrega do bloco ia');
    assert.deepEqual(entrega.valor, ['fixo-1', 'fixo-2']);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
    await app.fechar();
  }
});

test('resposta inválida da extensão → bloco falhou com diagnóstico', async () => {
  // maxTentativas: 1 — a violação de contrato falha de imediato, sem backoff.
  const app = await criarApp({ executarOpcoes: { maxTentativas: 1, dormir: dormirTeste } });
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ws-fixture-'));
  try {
    const origem = await criarFixture(tmp, 'saida-invalida');
    await instalarEConsentir(app.base, origem, FIXTURE_ID);

    const ordem = ['titulo', ...PROCESSOS.filter((p) => p !== 'titulo')];
    const canalId = await registarCanalComIa(app.base, 'Canal Mau', ordem, FIXTURE_ID);
    let r = await api(app.base, 'POST', '/api/projetos', { canalId, nome: 'P-mau' });
    const projetoId: number = r.dados.id;

    r = await api(app.base, 'POST', `/api/projetos/${projetoId}/avancar`);
    assert.equal(r.estado, 200);

    r = await api(app.base, 'POST', '/api/jobs/executar', {});
    assert.equal(r.estado, 200, JSON.stringify(r.dados));
    assert.equal((r.dados as ResumoExecucao).falhados, 1);

    const detalhe = (await api(app.base, 'GET', `/api/projetos/${projetoId}`)).dados;
    const bloco = blocosDe(detalhe).find((b) => b.blocoId === 't-ia');
    assert.equal(bloco.estado, 'falhou');
    assert.ok(bloco.erro && bloco.erro.length > 0, 'esperava diagnóstico no bloco');
    assert.ok(
      /contrato/i.test(bloco.erro),
      `o diagnóstico devia referir o contrato: "${bloco.erro}"`,
    );
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
    await app.fechar();
  }
});

test('extensão em falta → bloco falhou; diagnóstico menciona o id', async () => {
  const app = await criarApp();
  try {
    const ordem = ['titulo', ...PROCESSOS.filter((p) => p !== 'titulo')];
    const canalId = await registarCanalComIa(
      app.base,
      'Canal Fantasma',
      ordem,
      'extensao.inexistente',
    );
    let r = await api(app.base, 'POST', '/api/projetos', { canalId, nome: 'P-fantasma' });
    const projetoId: number = r.dados.id;

    r = await api(app.base, 'POST', `/api/projetos/${projetoId}/avancar`);
    assert.equal(r.estado, 200);

    // Erro de configuração: sem retry — uma passagem chega.
    r = await api(app.base, 'POST', '/api/jobs/executar', {});
    assert.equal(r.estado, 200, JSON.stringify(r.dados));
    assert.equal((r.dados as ResumoExecucao).falhados, 1);

    const detalhe = (await api(app.base, 'GET', `/api/projetos/${projetoId}`)).dados;
    const bloco = blocosDe(detalhe).find((b) => b.blocoId === 't-ia');
    assert.equal(bloco.estado, 'falhou');
    assert.ok(
      bloco.erro && bloco.erro.includes('extensao.inexistente'),
      `o diagnóstico devia mencionar a extensão em falta: "${bloco.erro}"`,
    );
  } finally {
    await app.fechar();
  }
});

test('jobs: listar pendentes; repetir repõe pendente; repetir 404', async () => {
  const app = await criarApp();
  try {
    const ordem = ['titulo', ...PROCESSOS.filter((p) => p !== 'titulo')];
    const canalId = await registarCanalComIa(
      app.base,
      'Canal Jobs',
      ordem,
      'extensao.inexistente',
    );
    let r = await api(app.base, 'POST', '/api/projetos', { canalId, nome: 'P-jobs' });
    const projetoId: number = r.dados.id;
    r = await api(app.base, 'POST', `/api/projetos/${projetoId}/avancar`);
    assert.equal(r.estado, 200);

    r = await api(app.base, 'GET', '/api/jobs/pendentes');
    assert.equal(r.estado, 200);
    assert.equal(r.dados.length, 1);
    assert.equal(r.dados[0].operador, 'ia');
    assert.equal(r.dados[0].bloco.blocoId, 't-ia');
    assert.equal(r.dados[0].bloco.extensaoId, 'extensao.inexistente');
    const jobId: number = r.dados[0].id;

    r = await api(app.base, 'POST', `/api/jobs/${jobId}/repetir`);
    assert.equal(r.estado, 200);
    assert.deepEqual(r.dados, { id: jobId, estado: 'pendente' });

    r = await api(app.base, 'POST', '/api/jobs/999/repetir');
    assert.equal(r.estado, 404);
  } finally {
    await app.fechar();
  }
});

test('rotas de extensões sem registo → 503 honesto', async () => {
  const banco = abrirBanco(':memory:');
  const app = express();
  app.use(express.json());
  app.use(criarRouter(banco, null));
  const servidor = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = servidor.address() as AddressInfo;
  try {
    const r = await api(`http://127.0.0.1:${port}`, 'GET', '/api/extensoes');
    assert.equal(r.estado, 503);
  } finally {
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
    banco.fechar();
  }
});

// Licensed under the Business Source License 1.1 — see LICENSE

// Testes do executor de jobs (M2): banco real `abrirBanco(':memory:')`
// (a camada db já expõe `listarJobsPendentes`, `incrementarTentativaJob`,
// `definirProximaExecucaoJob` e `extensaoId`) + duplos das dependências
// injetadas (`resolverCapacidade`, `carregarModulo`).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBanco, type Banco } from '../db/index.js';
import { avancar, criarProjeto } from './service.js';
import {
  executarJobsPendentes,
  type CapacidadeResolvida,
  type DepsExecutor,
  type PedidoExecucao,
} from './executor.js';
import type { Porta } from '../contracts/index.js';

// ---- montagem ----

const ORDEM_PROCESSOS = [
  'tema',
  'titulo',
  'thumbnail',
  'guiao',
  'narracao',
  'visuais',
  'edicao',
  'publicacao',
];

interface BlocoDef {
  id: string;
  tipo: string;
  operador: string;
  titulo: string;
  saidas?: unknown[];
  entradas?: unknown[];
  parametros?: unknown;
  extensaoId?: string;
}

const SAIDA_TEXTO = {
  chave: 'titulo',
  tipo: { tipo: 'conteudo', familia: 'texto', cardinalidade: 'um', representacao: 'embutido' },
};

const PORTA_TITULO: Porta = {
  chave: 'titulo',
  obrigatoria: true,
  tipo: { tipo: 'conteudo', familia: 'texto', cardinalidade: 'um', representacao: 'embutido' },
};

const BLOCO_IA: BlocoDef = {
  id: 'titulo-b1',
  tipo: 'CRIAR',
  operador: 'ia',
  titulo: 'Gerar título',
  saidas: [SAIDA_TEXTO],
  extensaoId: 'exemplo.titulos',
};

// Cria canal + projeto e avança o bloco do 'tema' (fica em_curso com job).
function montarCenario(blocosTema: BlocoDef[] = [BLOCO_IA]): { banco: Banco; canalId: number; projetoId: number } {
  const banco = abrirBanco(':memory:');
  const canal = banco.criarCanal('Canal', ORDEM_PROCESSOS);
  banco.guardarMetodo(canal.id, { processo: 'tema', blocos: blocosTema });
  for (const processo of ORDEM_PROCESSOS.slice(1)) {
    banco.guardarMetodo(canal.id, {
      processo,
      blocos: [{ id: `${processo}-1`, tipo: 'CRIAR', operador: 'humano', titulo: `Criar ${processo}` }],
    });
  }
  const projeto = criarProjeto(banco, canal.id, 'Projeto');
  const arranque = avancar(banco, projeto.projeto.id);
  assert.equal(arranque.acao, 'bloco_iniciado');
  assert.equal(arranque.execBloco?.estado, 'em_curso');
  return { banco, canalId: canal.id, projetoId: projeto.projeto.id };
}

function blocoTema(banco: Banco, projetoId: number) {
  const bloco = banco.obterExecBlocoPorBlocoId(projetoId, 'titulo-b1');
  assert.ok(bloco);
  return bloco;
}

function depsBase(overrides: Partial<DepsExecutor> = {}): DepsExecutor {
  return {
    resolverCapacidade: async (): Promise<CapacidadeResolvida> => ({
      extensaoId: 'exemplo.titulos',
      capacidadeId: 'titulos-1',
      moduloCaminho: '/extensoes/exemplo.titulos/mao.js',
      saidas: [PORTA_TITULO],
      efeitos: [],
    }),
    carregarModulo: async () => ({
      executar: async () => ({ saidas: { titulo: 'Um título gerado' } }),
    }),
    ...overrides,
  };
}

// ---- testes ----

describe('executarJobsPendentes', () => {
  it('caminho feliz: entrega válida → bloco concluído, entrega registada, job concluído', async () => {
    const { banco, projetoId } = montarCenario();
    let pedidoVisto: PedidoExecucao | undefined;
    const deps = depsBase({
      carregarModulo: async () => ({
        executar: async (pedido: PedidoExecucao) => {
          pedidoVisto = pedido;
          return { saidas: { titulo: 'Um título gerado' } };
        },
      }),
    });

    const resumo = await executarJobsPendentes(banco, deps);

    assert.equal(resumo.executados, 1);
    assert.equal(resumo.concluidos, 1);
    assert.equal(resumo.falhados, 0);
    assert.equal(resumo.adiados, 0);
    assert.equal(resumo.detalhes[0].resultado, 'concluido');
    assert.deepEqual(banco.listarJobsPendentes(), []);
    assert.equal(blocoTema(banco, projetoId).estado, 'concluido');
    const entregas = banco.listarEntregas(projetoId);
    assert.equal(entregas.length, 1);
    assert.equal(entregas[0]?.valor, 'Um título gerado');
    assert.deepEqual(entregas[0]?.tipo, PORTA_TITULO);
    // O pedido à extensão é bem formado.
    assert.equal(pedidoVisto?.capacidadeId, 'titulos-1');
    assert.equal(pedidoVisto?.extensaoId, 'exemplo.titulos');
    assert.deepEqual(pedidoVisto?.bloco, {
      id: 'titulo-b1',
      tipo: 'CRIAR',
      processo: 'tema',
      titulo: 'Gerar título',
    });
    assert.deepEqual(pedidoVisto?.entradas, {});
    assert.deepEqual(pedidoVisto?.saidasDeclaradas, [PORTA_TITULO]);
    assert.deepEqual(pedidoVisto?.efeitosDeclarados, []);
  });

  it('violação de contrato (tipo errado) → retry com backoff e depois falha com diagnóstico', async () => {
    const { banco, projetoId } = montarCenario();
    const deps = depsBase({
      carregarModulo: async () => ({
        executar: async () => ({ saidas: { titulo: 123 } }),
      }),
    });
    let agoraMs = Date.parse('2026-10-06T10:00:00.000Z');
    const opcoes = { maxTentativas: 2, esperaBaseMs: 1000, agora: () => new Date(agoraMs) };

    const r1 = await executarJobsPendentes(banco, deps, opcoes);
    assert.equal(r1.detalhes[0].resultado, 'ignorado');
    assert.match(r1.detalhes[0].detalhe ?? '', /violou o contrato/);
    assert.match(r1.detalhes[0].detalhe ?? '', /'titulo'/);
    assert.equal(r1.executados, 1);
    assert.equal(r1.concluidos, 0);
    assert.equal(r1.falhados, 0);
    const adiado = banco.listarJobsPendentes();
    assert.equal(adiado.length, 1); // voltou a pendente para retry
    assert.equal(adiado[0]?.tentativasJob, 1);
    assert.equal(adiado[0]?.proximaExecucao, new Date(agoraMs + 2000).toISOString());
    assert.equal(blocoTema(banco, projetoId).estado, 'em_curso'); // ainda em voo

    agoraMs += 2001;
    const r2 = await executarJobsPendentes(banco, deps, opcoes);
    assert.equal(r2.detalhes[0].resultado, 'falhado');
    assert.match(r2.detalhes[0].detalhe ?? '', /tentativas esgotadas/);
    assert.equal(r2.falhados, 1);
    assert.deepEqual(banco.listarJobsPendentes(), []);
    const bloco = blocoTema(banco, projetoId);
    assert.equal(bloco.estado, 'falhou');
    assert.match(bloco.erro ?? '', /'titulo'/);
    assert.equal(banco.listarEntregas(projetoId).length, 0); // nunca fingiu sucesso
  });

  it('violação de contrato (saída em falta) → ignorado na 1ª passagem, sem entrega', async () => {
    const { banco, projetoId } = montarCenario();
    const deps = depsBase({
      carregarModulo: async () => ({
        executar: async () => ({ saidas: {} }),
      }),
    });
    const resumo = await executarJobsPendentes(banco, deps, { maxTentativas: 3 });
    assert.equal(resumo.detalhes[0].resultado, 'ignorado');
    assert.match(resumo.detalhes[0].detalhe ?? '', /saída em falta: 'titulo'/);
    assert.equal(banco.listarJobsPendentes()[0]?.tentativasJob, 1);
    assert.equal(banco.listarEntregas(projetoId).length, 0);
  });

  it('resposta que não é objeto → violação de contrato', async () => {
    const { banco } = montarCenario();
    const deps = depsBase({
      carregarModulo: async () => ({
        executar: async () => 'só uma string' as unknown as { saidas: Record<string, unknown> },
      }),
    });
    const resumo = await executarJobsPendentes(banco, deps, { maxTentativas: 1 });
    assert.equal(resumo.detalhes[0].resultado, 'falhado');
    assert.match(resumo.detalhes[0].detalhe ?? '', /tem de ser um objeto/);
  });

  it('timeout da extensão (módulo que nunca resolve) → falha após esgotar tentativas', async () => {
    const { banco, projetoId } = montarCenario();
    const deps = depsBase({
      carregarModulo: async () => ({
        executar: () => new Promise<{ saidas: Record<string, unknown> }>(() => {}),
      }),
    });
    // Nota: o `dormir` injetado é o que dispara o timeout; aqui usa-se o
    // temporizador real com timeoutMs pequeno.
    const resumo = await executarJobsPendentes(banco, deps, { maxTentativas: 1, timeoutMs: 30 });
    assert.equal(resumo.falhados, 1);
    assert.equal(resumo.detalhes[0].resultado, 'falhado');
    assert.match(resumo.detalhes[0].detalhe ?? '', /tempo de execução esgotado/);
    assert.equal(blocoTema(banco, projetoId).estado, 'falhou');
  });

  it('extensão inativa/ausente → falha imediata sem retry, diagnóstico menciona a extensão', async () => {
    const { banco, projetoId } = montarCenario();
    const deps = depsBase({
      resolverCapacidade: async () => {
        throw new Error("extensão 'exemplo.titulos' não está ativa");
      },
    });
    const resumo = await executarJobsPendentes(banco, deps, { maxTentativas: 3 });
    assert.equal(resumo.executados, 1);
    assert.equal(resumo.falhados, 1);
    // 'falhado' (e não 'ignorado') à primeira prova que não houve retry.
    assert.equal(resumo.detalhes[0].resultado, 'falhado');
    assert.match(resumo.detalhes[0].detalhe ?? '', /exemplo\.titulos/);
    assert.match(resumo.detalhes[0].detalhe ?? '', /sem nova tentativa/);
    assert.deepEqual(banco.listarJobsPendentes(), []);
    assert.equal(blocoTema(banco, projetoId).estado, 'falhou');
  });

  it('capacidade ambígua → falha imediata sem retry', async () => {
    const { banco, projetoId } = montarCenario();
    const deps = depsBase({
      resolverCapacidade: async () => {
        throw new Error("mais do que uma capacidade compatível para o bloco 'CRIAR' do processo 'titulo'");
      },
    });
    const resumo = await executarJobsPendentes(banco, deps, { maxTentativas: 5 });
    assert.equal(resumo.detalhes[0].resultado, 'falhado');
    assert.match(resumo.detalhes[0].detalhe ?? '', /mais do que uma capacidade compatível/);
    assert.equal(blocoTema(banco, projetoId).estado, 'falhou');
  });

  it('bloco sem extensaoId → falha imediata de configuração, sem chamar o registo', async () => {
    const semExtensao: BlocoDef = { ...BLOCO_IA };
    delete semExtensao.extensaoId;
    const { banco, projetoId } = montarCenario([semExtensao]);
    let chamadas = 0;
    const deps = depsBase({
      resolverCapacidade: async () => {
        chamadas += 1;
        throw new Error('não devia ser chamado');
      },
    });
    const resumo = await executarJobsPendentes(banco, deps);
    assert.equal(chamadas, 0);
    assert.equal(resumo.detalhes[0].resultado, 'falhado');
    assert.match(resumo.detalhes[0].detalhe ?? '', /não tem extensão associada/);
    assert.equal(blocoTema(banco, projetoId).estado, 'falhou');
  });

  it('backoff: proximaExecucao crescente e job adiado na 2ª passagem', async () => {
    const { banco } = montarCenario();
    const deps = depsBase({
      carregarModulo: async () => ({
        executar: async (): Promise<{ saidas: Record<string, unknown> }> => {
          throw new Error('rebentou');
        },
      }),
    });
    let agoraMs = Date.parse('2026-10-06T10:00:00.000Z');
    const opcoes = { maxTentativas: 3, esperaBaseMs: 5000, agora: () => new Date(agoraMs) };

    const r1 = await executarJobsPendentes(banco, deps, opcoes);
    assert.equal(r1.detalhes[0].resultado, 'ignorado');
    const p1 = banco.listarJobsPendentes()[0]?.proximaExecucao;
    assert.equal(p1, new Date(agoraMs + 5000 * 2).toISOString()); // esperaBaseMs * 2^1

    // O banco lista o job (estado pendente); o executor salta-o: adiado.
    const r2 = await executarJobsPendentes(banco, deps, opcoes);
    assert.equal(r2.detalhes[0].resultado, 'adiado');
    assert.equal(r2.adiados, 1);
    assert.equal(r2.executados, 0);

    agoraMs += 5000 * 2 + 1;
    const r3 = await executarJobsPendentes(banco, deps, opcoes);
    assert.equal(r3.detalhes[0].resultado, 'ignorado');
    const p2 = banco.listarJobsPendentes()[0]?.proximaExecucao;
    assert.equal(p2, new Date(agoraMs + 5000 * 4).toISOString()); // esperaBaseMs * 2^2
    assert.ok((p2 as string) > (p1 as string), 'proximaExecucao crescente');

    agoraMs += 5000 * 4 + 1;
    const r4 = await executarJobsPendentes(banco, deps, opcoes);
    assert.equal(r4.detalhes[0].resultado, 'falhado');
    assert.deepEqual(banco.listarJobsPendentes(), []);

    const r5 = await executarJobsPendentes(banco, deps, opcoes); // sem pendentes
    assert.equal(r5.executados, 0);
    assert.deepEqual(r5.detalhes, []);
  });

  it('parametros do bloco chegam à extensão no pedido', async () => {
    const comParametros: BlocoDef = {
      ...BLOCO_IA,
      parametros: { tema: 'o meu tema', tentativasMax: 3 },
    };
    const { banco } = montarCenario([comParametros]);
    let pedidoVisto: PedidoExecucao | undefined;
    const deps = depsBase({
      carregarModulo: async () => ({
        executar: async (pedido: PedidoExecucao) => {
          pedidoVisto = pedido;
          return { saidas: { titulo: 'Um título gerado' } };
        },
      }),
    });

    const resumo = await executarJobsPendentes(banco, deps);
    assert.equal(resumo.concluidos, 1);
    assert.deepEqual(pedidoVisto?.bloco, {
      id: 'titulo-b1',
      tipo: 'CRIAR',
      processo: 'tema',
      titulo: 'Gerar título',
      parametros: { tema: 'o meu tema', tentativasMax: 3 },
    });
  });

  it('sem parametros declarados, o pedido não inclui a chave parametros', async () => {
    const { banco } = montarCenario();
    let pedidoVisto: PedidoExecucao | undefined;
    const deps = depsBase({
      carregarModulo: async () => ({
        executar: async (pedido: PedidoExecucao) => {
          pedidoVisto = pedido;
          return { saidas: { titulo: 'Um título gerado' } };
        },
      }),
    });
    await executarJobsPendentes(banco, deps);
    assert.ok(pedidoVisto);
    assert.ok(!('parametros' in (pedidoVisto?.bloco as object)));
  });

  it('entradas encadeadas: entrega do bloco anterior preenche a porta de entrada; chave sem entrega é omitida', async () => {
    const SAIDA_TEMA = {
      chave: 'tema',
      tipo: { tipo: 'conteudo', familia: 'texto', cardinalidade: 'um', representacao: 'embutido' },
    };
    const PORTA_TEMA: Porta = {
      chave: 'tema',
      obrigatoria: true,
      tipo: { tipo: 'conteudo', familia: 'texto', cardinalidade: 'um', representacao: 'embutido' },
    };
    const PORTA_INEXISTENTE: Porta = {
      chave: 'inexistente',
      obrigatoria: false,
      tipo: { tipo: 'conteudo', familia: 'texto', cardinalidade: 'um', representacao: 'embutido' },
    };
    const blocos: BlocoDef[] = [
      {
        id: 'enc-1',
        tipo: 'CRIAR',
        operador: 'ia',
        titulo: 'Produz tema',
        saidas: [SAIDA_TEMA],
        extensaoId: 'exemplo.titulos',
      },
      {
        id: 'enc-2',
        tipo: 'CRIAR',
        operador: 'ia',
        titulo: 'Consome tema',
        saidas: [SAIDA_TEMA],
        entradas: [PORTA_TEMA, PORTA_INEXISTENTE],
        extensaoId: 'exemplo.titulos',
      },
    ];
    const { banco, projetoId } = montarCenario(blocos);
    let pedidoVisto: PedidoExecucao | undefined;
    const deps = depsBase({
      resolverCapacidade: async (): Promise<CapacidadeResolvida> => ({
        extensaoId: 'exemplo.titulos',
        capacidadeId: 'titulos-1',
        moduloCaminho: '/extensoes/exemplo.titulos/mao.js',
        saidas: [PORTA_TEMA],
        efeitos: [],
      }),
      carregarModulo: async () => ({
        executar: async (pedido: PedidoExecucao) => {
          if (pedido.bloco.id === 'enc-2') {
            pedidoVisto = pedido;
            return { saidas: { tema: 'resposta do enc-2' } };
          }
          return { saidas: { tema: 'o tema entregue' } };
        },
      }),
    });

    // Bloco enc-1: produz a entrega.
    let resumo = await executarJobsPendentes(banco, deps);
    assert.equal(resumo.concluidos, 1);
    const enc1 = banco.obterExecBlocoPorBlocoId(projetoId, 'enc-1');
    assert.equal(enc1?.estado, 'concluido');

    // Bloco enc-2: recebe a entrega do anterior nas entradas.
    const arranque = avancar(banco, projetoId);
    assert.equal(arranque.acao, 'bloco_iniciado');
    assert.equal(arranque.execBloco?.blocoId, 'enc-2');
    resumo = await executarJobsPendentes(banco, deps);
    assert.equal(resumo.concluidos, 1);
    assert.deepEqual(pedidoVisto?.entradas, { tema: 'o tema entregue' });
    assert.ok(!('inexistente' in (pedidoVisto?.entradas as object)));
  });

  it('entradas encadeadas: quando dois blocos anteriores entregam a mesma chave, vence a mais recente', async () => {
    const SAIDA_TEMA = {
      chave: 'tema',
      tipo: { tipo: 'conteudo', familia: 'texto', cardinalidade: 'um', representacao: 'embutido' },
    };
    const PORTA_TEMA: Porta = {
      chave: 'tema',
      obrigatoria: true,
      tipo: { tipo: 'conteudo', familia: 'texto', cardinalidade: 'um', representacao: 'embutido' },
    };
    const mkBloco = (id: string, entradas?: unknown[]): BlocoDef => ({
      id,
      tipo: 'CRIAR',
      operador: 'ia',
      titulo: `Bloco ${id}`,
      saidas: [SAIDA_TEMA],
      ...(entradas ? { entradas } : {}),
      extensaoId: 'exemplo.titulos',
    });
    const { banco, projetoId } = montarCenario([mkBloco('a1'), mkBloco('a2'), mkBloco('a3', [PORTA_TEMA])]);
    const valores: Record<string, string> = { a1: 'tema antigo', a2: 'tema recente' };
    let pedidoVisto: PedidoExecucao | undefined;
    const deps = depsBase({
      resolverCapacidade: async (): Promise<CapacidadeResolvida> => ({
        extensaoId: 'exemplo.titulos',
        capacidadeId: 'titulos-1',
        moduloCaminho: '/extensoes/exemplo.titulos/mao.js',
        saidas: [PORTA_TEMA],
        efeitos: [],
      }),
      carregarModulo: async () => ({
        executar: async (pedido: PedidoExecucao) => {
          if (pedido.bloco.id === 'a3') {
            pedidoVisto = pedido;
            return { saidas: { tema: 'ok' } };
          }
          return { saidas: { tema: valores[pedido.bloco.id] } };
        },
      }),
    });

    for (const esperado of ['a1', 'a2', 'a3']) {
      const r = await executarJobsPendentes(banco, deps);
      assert.equal(r.concluidos, 1);
      if (esperado !== 'a3') {
        const arranque = avancar(banco, projetoId);
        assert.equal(arranque.execBloco?.blocoId, esperado === 'a1' ? 'a2' : 'a3');
      }
    }
    assert.deepEqual(pedidoVisto?.entradas, { tema: 'tema recente' });
  });

  it('processa jobs em sequência: um falha, o outro conclui', async () => {
    const { banco, canalId, projetoId } = montarCenario();
    const projeto2 = criarProjeto(banco, canalId, 'Projeto 2');
    const arranque2 = avancar(banco, projeto2.projeto.id);
    assert.equal(arranque2.acao, 'bloco_iniciado');
    assert.equal(banco.listarJobsPendentes().length, 2);

    let chamadas = 0;
    const deps = depsBase({
      resolverCapacidade: async () => {
        chamadas += 1;
        if (chamadas === 1) throw new Error("extensão 'exemplo.titulos' não está ativa");
        return {
          extensaoId: 'exemplo.titulos',
          capacidadeId: 'titulos-1',
          moduloCaminho: '/extensoes/exemplo.titulos/mao.js',
          saidas: [PORTA_TITULO],
          efeitos: [],
        };
      },
    });
    const resumo = await executarJobsPendentes(banco, deps, { maxTentativas: 1 });
    assert.equal(resumo.executados, 2);
    assert.equal(resumo.concluidos, 1);
    assert.equal(resumo.falhados, 1);
    assert.deepEqual(
      resumo.detalhes.map((d) => d.resultado),
      ['falhado', 'concluido'],
    );
    assert.equal(blocoTema(banco, projetoId).estado, 'falhou');
    assert.equal(blocoTema(banco, projeto2.projeto.id).estado, 'concluido');
  });
});

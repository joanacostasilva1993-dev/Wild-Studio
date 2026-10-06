// Licensed under the Business Source License 1.1 — see LICENSE

/**
 * Testes da camada de dados (SQLite em memória).
 *
 * Cobrem: canais, versionamento de métodos, criação de projetos com
 * snapshot imutável, falha sem métodos completos, entregas, aprovações,
 * tentativas, jobs e a ordem do próximo bloco pendente.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { abrirBanco, type Banco, type EstadoExec } from './index.js';

const ORDEM = ['tema', 'titulo', 'thumbnail', 'guiao', 'narracao', 'visuais', 'edicao', 'publicacao'];

let banco: Banco;

beforeEach(() => {
  banco = abrirBanco();
});

afterEach(() => {
  banco.fechar();
});

/** Guarda um método de um bloco para cada processo da ordem. */
function guardarMetodosCompletos(titulo: (processo: string) => string): void {
  for (const processo of ORDEM) {
    banco.guardarMetodo(1, {
      processo,
      blocos: [{ id: `${processo}-b1`, tipo: 'CRIAR', operador: 'humano', titulo: titulo(processo), saidas: [] }],
    });
  }
}

function criarCanalBase(): number {
  return banco.criarCanal('Canal Teste', ORDEM).id;
}

describe('canais', () => {
  it('cria, lista e obtém um canal com a ordem de processos', () => {
    const canal = banco.criarCanal('Canal A', ORDEM);
    assert.equal(typeof canal.id, 'number');
    assert.deepEqual(canal.ordemProcessos, ORDEM);

    const canais = banco.listarCanais();
    assert.equal(canais.length, 1);
    assert.deepEqual(canais[0], { id: canal.id, nome: 'Canal A' });

    const obtido = banco.obterCanal(canal.id);
    assert.deepEqual(obtido, { id: canal.id, nome: 'Canal A', ordemProcessos: ORDEM });
  });

  it('devolve undefined para canal inexistente', () => {
    assert.equal(banco.obterCanal(999), undefined);
  });

  it('rejeita ordens inválidas (vazia, duplicada, tamanho diferente de 8)', () => {
    assert.throws(() => banco.criarCanal('X', []), /não vazio/);
    assert.throws(() => banco.criarCanal('X', [...ORDEM, 'tema']), /duplicado|exatamente 8/);
    assert.throws(() => banco.criarCanal('X', ['tema']), /exatamente 8/);
    assert.throws(() => banco.criarCanal('', ORDEM), /não pode estar vazio/);
  });
});

describe('metodos', () => {
  it('versiona 1, 2, 3 e o vigente é a última versão', () => {
    criarCanalBase();
    const metodo = (titulo: string) => ({
      processo: 'tema',
      blocos: [{ id: 'b1', tipo: 'CRIAR', operador: 'humano', titulo, saidas: [] }],
    });
    assert.equal(banco.guardarMetodo(1, metodo('v1')), 1);
    assert.equal(banco.guardarMetodo(1, metodo('v2')), 2);
    assert.equal(banco.guardarMetodo(1, metodo('v3')), 3);

    const vigente = banco.obterMetodoVigente(1, 'tema');
    assert.equal(vigente?.versao, 3);
    assert.equal(vigente?.definicao.blocos[0].titulo, 'v3');
    assert.equal(vigente?.definicao.processo, 'tema');
  });

  it('versões de processos diferentes são independentes', () => {
    criarCanalBase();
    banco.guardarMetodo(1, { processo: 'tema', blocos: [{ id: 'b1', tipo: 'CRIAR', operador: 'humano', titulo: 't', saidas: [] }] });
    assert.equal(banco.obterMetodoVigente(1, 'titulo'), undefined);
    assert.equal(banco.obterMetodoVigente(1, 'tema')?.versao, 1);
  });

  it('rejeita processo fora da ordem do canal e método sem blocos', () => {
    criarCanalBase();
    assert.throws(() => banco.guardarMetodo(1, { processo: 'inexistente', blocos: [] }), /não consta da ordem/);
    assert.throws(
      () => banco.guardarMetodo(1, { processo: 'tema', blocos: [] }),
      /pelo menos um bloco/,
    );
    assert.throws(() => banco.guardarMetodo(999, { processo: 'tema', blocos: [{ id: 'b', tipo: 'CRIAR', operador: 'humano', titulo: 't', saidas: [] }] }), /não existe/);
  });

  it('rejeita blocos com tipo ou operador inválidos', () => {
    criarCanalBase();
    assert.throws(
      () => banco.guardarMetodo(1, { processo: 'tema', blocos: [{ id: 'b', tipo: 'MAGIA', operador: 'humano', titulo: 't', saidas: [] }] }),
      /tipo inválido/,
    );
    assert.throws(
      () => banco.guardarMetodo(1, { processo: 'tema', blocos: [{ id: 'b', tipo: 'CRIAR', operador: 'robot', titulo: 't', saidas: [] }] }),
      /operador inválido/,
    );
  });
});

describe('projetos', () => {
  it('cria projeto com processos e blocos pendentes na ordem do canal', () => {
    criarCanalBase();
    guardarMetodosCompletos((p) => `Bloco ${p}`);
    const detalhado = banco.criarProjeto(1, 'Projeto 1');

    assert.equal(detalhado.projeto.nome, 'Projeto 1');
    assert.equal(detalhado.projeto.canalId, 1);
    assert.equal(detalhado.projeto.estado, 'ativo');
    assert.equal(detalhado.processos.length, 8);
    assert.deepEqual(
      detalhado.processos.map((p) => p.processo),
      ORDEM,
    );
    for (const [i, p] of detalhado.processos.entries()) {
      assert.equal(p.ordem, i);
      assert.equal(p.estado, 'pendente');
      assert.equal(p.blocos.length, 1);
      assert.equal(p.blocos[0].estado, 'pendente');
      assert.equal(p.blocos[0].tentativa, 1);
      assert.equal(p.blocos[0].processo, p.processo);
      assert.equal(p.blocos[0].blocoId, `${p.processo}-b1`);
    }

    const obtido = banco.obterProjeto(detalhado.projeto.id);
    assert.deepEqual(obtido, detalhado);
  });

  it('falha com erro claro quando falta método vigente para algum processo', () => {
    criarCanalBase();
    // Guarda métodos só para 7 dos 8 processos.
    for (const processo of ORDEM.slice(0, 7)) {
      banco.guardarMetodo(1, {
        processo,
        blocos: [{ id: 'b1', tipo: 'CRIAR', operador: 'humano', titulo: 't', saidas: [] }],
      });
    }
    assert.throws(() => banco.criarProjeto(1, 'Projeto X'), /Falta método vigente para o processo 'publicacao'/);
    assert.throws(() => banco.criarProjeto(999, 'Projeto X'), /não existe/);
  });

  it('congela o snapshot: editar o método não altera projetos existentes', () => {
    criarCanalBase();
    guardarMetodosCompletos(() => 'título v1');
    const antigo = banco.criarProjeto(1, 'Antigo');

    // Nova versão para todos os processos.
    guardarMetodosCompletos(() => 'título v2');

    const antigoDepois = banco.obterProjeto(antigo.projeto.id);
    assert.equal(antigoDepois?.processos[0].blocos[0].titulo, 'título v1');
    assert.equal(antigoDepois?.processos[7].blocos[0].titulo, 'título v1');

    const novo = banco.criarProjeto(1, 'Novo');
    assert.equal(novo.processos[0].blocos[0].titulo, 'título v2');
    assert.equal(novo.processos[7].blocos[0].titulo, 'título v2');

    // O método vigente do canal é mesmo a v2.
    assert.equal(banco.obterMetodoVigente(1, 'tema')?.versao, 2);
  });

  it('lista projetos e marca estado concluído/cancelado', () => {
    criarCanalBase();
    guardarMetodosCompletos(() => 't');
    const p1 = banco.criarProjeto(1, 'P1');
    banco.criarProjeto(1, 'P2');

    const lista = banco.listarProjetos();
    assert.equal(lista.length, 2);
    assert.deepEqual(lista[0], { id: p1.projeto.id, canalId: 1, nome: 'P1', estado: 'ativo' });

    banco.marcarProjeto(p1.projeto.id, 'concluido');
    assert.equal(banco.obterProjeto(p1.projeto.id)?.projeto.estado, 'concluido');
    banco.marcarProjeto(p1.projeto.id, 'cancelado');
    assert.equal(banco.obterProjeto(p1.projeto.id)?.projeto.estado, 'cancelado');
    assert.throws(() => banco.marcarProjeto(999, 'concluido'), /não existe/);
  });
});

describe('execuções de bloco', () => {
  it('obtém bloco por id e por blocoId, define estado e erro', () => {
    criarCanalBase();
    guardarMetodosCompletos(() => 't');
    const projeto = banco.criarProjeto(1, 'P');
    const blocoId = 'tema-b1';

    const porBlocoId = banco.obterExecBlocoPorBlocoId(projeto.projeto.id, blocoId);
    assert.ok(porBlocoId);
    assert.equal(porBlocoId?.blocoId, blocoId);
    assert.equal(porBlocoId?.processo, 'tema');
    assert.deepEqual(porBlocoId?.saidas, []);

    const porId = banco.obterExecBloco(porBlocoId!.id);
    assert.deepEqual(porId, porBlocoId);
    assert.equal(banco.obterExecBloco(99999), undefined);
    assert.equal(banco.obterExecBlocoPorBlocoId(projeto.projeto.id, 'nao-existe'), undefined);

    const estados: EstadoExec[] = ['em_curso', 'aguardar_aprovacao', 'concluido'];
    for (const estado of estados) {
      banco.definirEstadoBloco(porBlocoId!.id, estado);
      assert.equal(banco.obterExecBloco(porBlocoId!.id)?.estado, estado);
    }
    banco.definirEstadoBloco(porBlocoId!.id, 'falhou', 'rebentou o motor');
    const falhado = banco.obterExecBloco(porBlocoId!.id);
    assert.equal(falhado?.estado, 'falhou');
    assert.equal(falhado?.erro, 'rebentou o motor');
    // erro=null limpa o campo.
    banco.definirEstadoBloco(porBlocoId!.id, 'em_curso', null);
    assert.equal(banco.obterExecBloco(porBlocoId!.id)?.erro, null);

    assert.throws(() => banco.definirEstadoBloco(porBlocoId!.id, 'voando' as EstadoExec), /inválido/);
    assert.throws(() => banco.definirEstadoBloco(99999, 'concluido'), /não existe/);
  });

  it('incrementarTentativa devolve o novo número', () => {
    criarCanalBase();
    guardarMetodosCompletos(() => 't');
    const projeto = banco.criarProjeto(1, 'P');
    const bloco = banco.obterExecBlocoPorBlocoId(projeto.projeto.id, 'tema-b1')!;
    assert.equal(banco.incrementarTentativa(bloco.id), 2);
    assert.equal(banco.incrementarTentativa(bloco.id), 3);
    assert.equal(banco.obterExecBloco(bloco.id)?.tentativa, 3);
    assert.throws(() => banco.incrementarTentativa(99999), /não existe/);
  });
});

describe('entregas, aprovações e tentativas', () => {
  it('regista e lista entregas com tipo/valor preservados', () => {
    criarCanalBase();
    guardarMetodosCompletos(() => 't');
    const projeto = banco.criarProjeto(1, 'P');
    const bloco = banco.obterExecBlocoPorBlocoId(projeto.projeto.id, 'tema-b1')!;

    const tipo = { familia: 'texto', cardinalidade: 'um', representacao: 'embutido' };
    const e1 = banco.registarEntrega(bloco.id, projeto.projeto.id, 1, tipo, { texto: 'olá' });
    banco.registarEntrega(bloco.id, projeto.projeto.id, 2, tipo, { texto: 'olá outra vez' });

    const entregas = banco.listarEntregas(projeto.projeto.id);
    assert.equal(entregas.length, 2);
    assert.equal(entregas[0].id, e1.id);
    assert.equal(entregas[0].execBlocoId, bloco.id);
    assert.equal(entregas[0].tentativa, 1);
    assert.deepEqual(entregas[0].tipo, tipo);
    assert.deepEqual(entregas[0].valor, { texto: 'olá' });
    assert.equal(typeof entregas[0].criadaEm, 'string');
    assert.equal(entregas[1].tentativa, 2);
    // Projeto sem entregas devolve lista vazia.
    assert.deepEqual(banco.listarEntregas(99999), []);
  });

  it('regista aprovações e tentativas sem lançar', () => {
    criarCanalBase();
    guardarMetodosCompletos(() => 't');
    const projeto = banco.criarProjeto(1, 'P');
    const bloco = banco.obterExecBlocoPorBlocoId(projeto.projeto.id, 'tema-b1')!;

    banco.registarAprovacao(bloco.id, 'aprovado', 'Joana', 'parece-me bem');
    banco.registarAprovacao(bloco.id, 'rejeitado');
    assert.throws(() => banco.registarAprovacao(bloco.id, 'talvez' as 'aprovado'), /inválida/);

    banco.registarTentativa(bloco.id, 1, 'pendente', 'em_curso', 'primeira passagem');
    banco.registarTentativa(bloco.id, 2, 'falhou', 'em_curso');
    assert.throws(() => banco.registarTentativa(bloco.id, 3, 'x', 'em_curso'), /inválido/);
  });
});

describe('jobs', () => {
  it('cria e atualiza jobs de blocos ia/codigo', () => {
    criarCanalBase();
    guardarMetodosCompletos(() => 't');
    const projeto = banco.criarProjeto(1, 'P');
    const bloco = banco.obterExecBlocoPorBlocoId(projeto.projeto.id, 'tema-b1')!;

    const job = banco.criarJob(bloco.id, 'ia');
    assert.equal(typeof job.id, 'number');
    banco.criarJob(bloco.id, 'codigo');

    banco.atualizarJob(job.id, 'em_curso');
    banco.atualizarJob(job.id, 'concluido', 'terminado com sucesso');
    assert.throws(() => banco.atualizarJob(job.id, 'a_voar' as 'concluido'), /inválido/);
    assert.throws(() => banco.atualizarJob(99999, 'concluido'), /não existe/);
    assert.throws(() => banco.criarJob(bloco.id, 'humano' as 'ia'), /inválido/);
  });
});

describe('proximoBlocoPendente', () => {
  it('respeita a ordem do snapshot: processos por ordem, blocos por inserção', () => {
    criarCanalBase();
    // Método com vários blocos no primeiro processo e um no segundo.
    banco.guardarMetodo(1, {
      processo: 'tema',
      blocos: [
        { id: 't-a', tipo: 'PESQUISAR', operador: 'humano', titulo: 'A', saidas: [] },
        { id: 't-b', tipo: 'ESCOLHER', operador: 'humano', titulo: 'B', saidas: [] },
      ],
    });
    banco.guardarMetodo(1, {
      processo: 'titulo',
      blocos: [{ id: 'ti-a', tipo: 'CRIAR', operador: 'humano', titulo: 'C', saidas: [] }],
    });
    for (const processo of ORDEM.slice(2)) {
      banco.guardarMetodo(1, {
        processo,
        blocos: [{ id: `${processo}-x`, tipo: 'CRIAR', operador: 'humano', titulo: 'x', saidas: [] }],
      });
    }
    const projeto = banco.criarProjeto(1, 'P');
    const pid = projeto.projeto.id;

    const primeiro = banco.proximoBlocoPendente(pid);
    assert.equal(primeiro?.blocoId, 't-a');

    banco.definirEstadoBloco(primeiro!.id, 'concluido');
    assert.equal(banco.proximoBlocoPendente(pid)?.blocoId, 't-b');

    const segundo = banco.proximoBlocoPendente(pid)!;
    banco.definirEstadoBloco(segundo.id, 'concluido');
    // Passa ao processo seguinte (titulo), mesmo havendo blocos noutro estado.
    assert.equal(banco.proximoBlocoPendente(pid)?.blocoId, 'ti-a');

    // Conclui tudo: já não há pendentes.
    for (const p of banco.obterProjeto(pid)!.processos) {
      for (const b of p.blocos) {
        if (b.estado === 'pendente') banco.definirEstadoBloco(b.id, 'concluido');
      }
    }
    assert.equal(banco.proximoBlocoPendente(pid), undefined);
  });
});

describe('migrações M2', () => {
  it('abrirBanco é idempotente: colunas novas existem e dados antigos sobrevivem', () => {
    const caminho = path.join(os.tmpdir(), `ws-m2-${process.pid}-${Date.now()}.sqlite`);
    try {
      const b1 = abrirBanco(caminho);
      const canalId = b1.criarCanal('Canal M2', ORDEM).id;
      for (const processo of ORDEM) {
        b1.guardarMetodo(canalId, {
          processo,
          blocos: [{ id: `${processo}-b1`, tipo: 'CRIAR', operador: 'humano', titulo: 't', saidas: [] }],
        });
      }
      const projeto = b1.criarProjeto(canalId, 'P');
      const bloco = b1.obterExecBlocoPorBlocoId(projeto.projeto.id, 'tema-b1')!;
      const job = b1.criarJob(bloco.id, 'ia');
      b1.fechar();

      // Reabrir corre as migrações outra vez, sem erro (idempotência).
      const b2 = abrirBanco(caminho);
      try {
        const crua = new Database(caminho, { readonly: true });
        try {
          const colunas = (tabela: string): string[] =>
            (crua.prepare(`PRAGMA table_info(${tabela})`).all() as { name: string }[]).map((c) => c.name);
          assert.ok(colunas('execucoes_bloco').includes('extensao_id'));
          assert.ok(colunas('jobs').includes('tentativas'));
          assert.ok(colunas('jobs').includes('proxima_execucao'));
          assert.ok(colunas('extensoes').includes('ativa'));
          assert.ok(colunas('capacidades').includes('definicao'));
        } finally {
          crua.close();
        }

        // Os dados criados antes continuam lá; o job antigo tem tentativas=0.
        const pendentes = b2.listarJobsPendentes();
        assert.equal(pendentes.length, 1);
        assert.equal(pendentes[0].jobId, job.id);
        assert.equal(pendentes[0].tentativasJob, 0);
        assert.equal(pendentes[0].extensaoId, null);
      } finally {
        b2.fechar();
      }
    } finally {
      fs.rmSync(caminho, { force: true });
    }
  });
});

describe('execucoes_bloco com extensaoId (M2)', () => {
  it('guarda o extensaoId do método na coluna nova (null quando ausente)', () => {
    criarCanalBase();
    for (const processo of ORDEM) {
      const blocos =
        processo === 'tema'
          ? [
              {
                id: 'tema-ia',
                tipo: 'CRIAR',
                operador: 'ia',
                titulo: 'IA',
                saidas: [],
                extensaoId: 'exemplo.titulos-ia',
              },
              { id: 'tema-h', tipo: 'CRIAR', operador: 'humano', titulo: 'H', saidas: [] },
            ]
          : [{ id: `${processo}-b1`, tipo: 'CRIAR', operador: 'humano', titulo: 't', saidas: [] }];
      banco.guardarMetodo(1, { processo, blocos });
    }
    const projeto = banco.criarProjeto(1, 'P');
    const pid = projeto.projeto.id;
    assert.equal(banco.obterExecBlocoPorBlocoId(pid, 'tema-ia')?.extensaoId, 'exemplo.titulos-ia');
    assert.equal(banco.obterExecBlocoPorBlocoId(pid, 'tema-h')?.extensaoId, null);
    assert.equal(banco.obterExecBlocoPorBlocoId(pid, 'titulo-b1')?.extensaoId, null);
    // Também visível na visão detalhada do projeto.
    const detalhado = banco.obterProjeto(pid)!;
    const blocoIa = detalhado.processos[0].blocos.find((b) => b.blocoId === 'tema-ia')!;
    assert.equal(blocoIa.extensaoId, 'exemplo.titulos-ia');
  });
});

describe('extensoes (M2)', () => {
  const registo = () => ({
    id: 'exemplo.titulos-ia',
    nome: 'Títulos IA',
    versao: '0.1.0',
    autor: 'Wild Studio',
    licenca: 'BSL-1.1',
    caminho: '/extensoes/exemplo.titulos-ia',
  });

  it('instala, lista, obtém, ativa/desativa e remove', () => {
    assert.deepEqual(banco.listarExtensoes(), []);
    assert.equal(banco.obterExtensao('exemplo.titulos-ia'), undefined);

    banco.instalarExtensao(registo());
    assert.throws(() => banco.instalarExtensao(registo()), /já está instalada/);

    assert.deepEqual(banco.listarExtensoes(), [
      { id: 'exemplo.titulos-ia', nome: 'Títulos IA', versao: '0.1.0', ativa: false },
    ]);

    const obtida = banco.obterExtensao('exemplo.titulos-ia')!;
    assert.equal(obtida.autor, 'Wild Studio');
    assert.equal(obtida.licenca, 'BSL-1.1');
    assert.equal(obtida.caminho, '/extensoes/exemplo.titulos-ia');
    assert.equal(obtida.ativa, false);
    assert.equal(obtida.notaConsentimento, null);
    assert.equal(typeof obtida.instaladaEm, 'string');

    banco.definirExtensaoAtiva('exemplo.titulos-ia', true, 'consentimento de teste');
    const ativa = banco.obterExtensao('exemplo.titulos-ia')!;
    assert.equal(ativa.ativa, true);
    assert.equal(ativa.notaConsentimento, 'consentimento de teste');

    // Revogar sem nota nova mantém a nota anterior.
    banco.definirExtensaoAtiva('exemplo.titulos-ia', false);
    assert.equal(banco.obterExtensao('exemplo.titulos-ia')?.ativa, false);
    assert.equal(banco.obterExtensao('exemplo.titulos-ia')?.notaConsentimento, 'consentimento de teste');

    assert.throws(() => banco.definirExtensaoAtiva('fantasma', true), /não está instalada/);

    banco.removerExtensao('exemplo.titulos-ia');
    assert.equal(banco.obterExtensao('exemplo.titulos-ia'), undefined);
    assert.deepEqual(banco.listarExtensoes(), []);
    assert.throws(() => banco.removerExtensao('exemplo.titulos-ia'), /não está instalada/);
  });

  it('rejeita registo com campos vazios', () => {
    assert.throws(() => banco.instalarExtensao({ ...registo(), nome: '  ' }), /não pode estar vazio/);
  });

  it('guardarCapacidades faz roundtrip da definição e substitui em nova gravação', () => {
    banco.instalarExtensao(registo());
    assert.deepEqual(banco.obterCapacidades('exemplo.titulos-ia'), []);

    const cap1 = { id: 'gerar-titulos', definicao: { operador: 'ia', blocos: ['CRIAR'] } };
    banco.guardarCapacidades('exemplo.titulos-ia', [cap1]);
    assert.deepEqual(banco.obterCapacidades('exemplo.titulos-ia'), [cap1]);

    const cap2 = { id: 'outra', definicao: { operador: 'codigo' } };
    banco.guardarCapacidades('exemplo.titulos-ia', [cap2]);
    assert.deepEqual(banco.obterCapacidades('exemplo.titulos-ia'), [cap2]);

    // removerExtensao apaga as capacidades junto com a extensão.
    banco.removerExtensao('exemplo.titulos-ia');
    assert.deepEqual(banco.obterCapacidades('exemplo.titulos-ia'), []);
  });

  it('guardarCapacidades lança para extensão ausente', () => {
    assert.throws(() => banco.guardarCapacidades('fantasma', []), /não está instalada/);
  });
});

describe('listarJobsPendentes e retries de job (M2)', () => {
  function prepararProjetoComJobs(): { pid: number; blocoIa: number; blocoCodigo: number } {
    criarCanalBase();
    for (const processo of ORDEM) {
      const blocos =
        processo === 'tema'
          ? [
              {
                id: 'tema-ia',
                tipo: 'CRIAR',
                operador: 'ia',
                titulo: 'IA',
                saidas: [],
                extensaoId: 'exemplo.titulos-ia',
              },
              {
                id: 'tema-codigo',
                tipo: 'PESQUISAR',
                operador: 'codigo',
                titulo: 'Código',
                saidas: [],
                extensaoId: 'exemplo.pesquisa',
              },
            ]
          : [{ id: `${processo}-b1`, tipo: 'CRIAR', operador: 'humano', titulo: 't', saidas: [] }];
      banco.guardarMetodo(1, { processo, blocos });
    }
    const projeto = banco.criarProjeto(1, 'P');
    const pid = projeto.projeto.id;
    const blocoIa = banco.obterExecBlocoPorBlocoId(pid, 'tema-ia')!.id;
    const blocoCodigo = banco.obterExecBlocoPorBlocoId(pid, 'tema-codigo')!.id;
    return { pid, blocoIa, blocoCodigo };
  }

  it('lista só jobs pendentes, com o contexto do bloco', () => {
    const { pid, blocoIa, blocoCodigo } = prepararProjetoComJobs();
    const j1 = banco.criarJob(blocoIa, 'ia');
    const j2 = banco.criarJob(blocoCodigo, 'codigo');
    banco.atualizarJob(j2.id, 'em_curso');

    const pendentes = banco.listarJobsPendentes();
    assert.equal(pendentes.length, 1);
    const p = pendentes[0];
    assert.equal(p.jobId, j1.id);
    assert.equal(p.execBlocoId, blocoIa);
    assert.equal(p.projetoId, pid);
    assert.equal(p.blocoId, 'tema-ia');
    assert.equal(p.tipo, 'CRIAR');
    assert.equal(p.operador, 'ia');
    assert.equal(p.processo, 'tema');
    assert.equal(p.titulo, 'IA');
    assert.equal(p.extensaoId, 'exemplo.titulos-ia');
    assert.deepEqual(p.saidas, []);
    assert.equal(p.tentativa, 1);
    assert.equal(p.tentativasJob, 0);
    // Colunas do job em bruto (compatibilidade com executor/API).
    assert.equal(p.id, j1.id);
    assert.equal(p.estado, 'pendente');
    assert.equal(p.detalhe, null);
    assert.equal(typeof p.criadaEm, 'string');
    assert.equal(p.tentativas, 0);
    assert.equal(p.proximaExecucao, null);
  });

  it('incrementarTentativaJob conta passagens; definirProximaExecucaoJob aceita e limpa', () => {
    const { blocoIa } = prepararProjetoComJobs();
    const job = banco.criarJob(blocoIa, 'ia');
    assert.equal(banco.incrementarTentativaJob(job.id), 1);
    assert.equal(banco.incrementarTentativaJob(job.id), 2);
    assert.equal(banco.listarJobsPendentes()[0].tentativasJob, 2);

    banco.definirProximaExecucaoJob(job.id, '2026-10-06T12:00:00Z');
    banco.definirProximaExecucaoJob(job.id, null);

    assert.throws(() => banco.incrementarTentativaJob(99999), /não existe/);
    assert.throws(() => banco.definirProximaExecucaoJob(99999, null), /não existe/);
  });

  it('sem jobs pendentes devolve lista vazia', () => {
    assert.deepEqual(banco.listarJobsPendentes(), []);
  });
});

// Licensed under the Business Source License 1.1 — see LICENSE

// Testes de integração do motor sobre `abrirBanco(':memory:')`, contra o
// módulo real `db`. Os canais e métodos são montados à mão no teste (sem
// depender do módulo de gramática), só com a forma mínima de que o motor
// precisa. O `db` exige os 8 processos com método vigente, por isso os 7
// processos fora do foco levam um bloco humano trivial cada um.
//
// Nota: o `db` arranca cada bloco com tentativa=1; `avancar` incrementa.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBanco, type Banco, type ExecBlocoRow } from '../db/index.js';
import {
  criarProjeto,
  avancar,
  submeterEntrega,
  aprovar,
  rejeitar,
  repetir,
  falhar,
  cancelar,
  retomar,
  estadoProjeto,
} from './service.js';

// ---- montagem de canais e métodos ----

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
}

const SAIDA_TEXTO = {
  chave: 'texto',
  tipo: { tipo: 'conteudo', familia: 'texto', cardinalidade: 'um', representacao: 'embutido' },
};

// Cria um canal com os 8 processos; o processo 'tema' leva os blocos dados,
// os restantes levam um bloco humano trivial (sem saídas declaradas).
function criarCanal(banco: Banco, nome: string, blocosTema: BlocoDef[]): number {
  const canal = banco.criarCanal(nome, ORDEM_PROCESSOS);
  banco.guardarMetodo(canal.id, { processo: 'tema', blocos: blocosTema });
  for (const processo of ORDEM_PROCESSOS.slice(1)) {
    banco.guardarMetodo(canal.id, {
      processo,
      blocos: [{ id: `${processo}-1`, tipo: 'CRIAR', operador: 'humano', titulo: `Criar ${processo}` }],
    });
  }
  return canal.id;
}

function blocosCriarValidar(): BlocoDef[] {
  return [
    { id: 'b1', tipo: 'CRIAR', operador: 'humano', titulo: 'Escrever título', saidas: [SAIDA_TEXTO] },
    { id: 'b2', tipo: 'VALIDAR', operador: 'humano', titulo: 'Validar título' },
  ];
}

// ---- ajudas ----

let banco: Banco;

beforeEach(() => {
  banco = abrirBanco(':memory:');
});

afterEach(() => {
  banco.fechar();
});

function criarProjetoTitulo(): number {
  const canalId = criarCanal(banco, 'Canal de teste', blocosCriarValidar());
  return criarProjeto(banco, canalId, 'Projeto 1').projeto.id;
}

function execBloco(projetoId: number, blocoId: string): ExecBlocoRow {
  const bloco = banco.obterExecBlocoPorBlocoId(projetoId, blocoId);
  assert.ok(bloco, `bloco '${blocoId}' devia existir`);
  return bloco;
}

function estadoDe(projetoId: number, blocoId: string): string {
  return execBloco(projetoId, blocoId).estado;
}

// Conclui os 7 blocos triviais dos processos fora do 'tema'.
function concluirBlocosTriviais(projetoId: number): void {
  for (let i = 0; i < 7; i++) {
    const r = avancar(banco, projetoId);
    assert.equal(r.acao, 'bloco_iniciado');
    assert.ok(r.execBloco, 'avancar devia devolver o bloco iniciado');
    submeterEntrega(banco, r.execBloco.id, 'ok');
  }
}

describe('ciclo de vida: CRIAR humano → VALIDAR → projeto concluído', () => {
  it('cria o projeto com os blocos pendentes (tentativa 1)', () => {
    const projetoId = criarProjetoTitulo();
    const b1 = execBloco(projetoId, 'b1');
    assert.equal(b1.estado, 'pendente');
    assert.equal(b1.tentativa, 1);
    assert.equal(estadoDe(projetoId, 'b2'), 'pendente');
  });

  it('avancar inicia o bloco CRIAR humano (tentativa 2)', () => {
    const projetoId = criarProjetoTitulo();
    const r = avancar(banco, projetoId);
    assert.equal(r.acao, 'bloco_iniciado');
    assert.equal(r.execBloco?.blocoId, 'b1');
    assert.equal(r.execBloco?.estado, 'em_curso');
    assert.equal(r.execBloco?.tentativa, 2);
  });

  it('entrega inválida é rejeitada sem mudar o estado', () => {
    const projetoId = criarProjetoTitulo();
    avancar(banco, projetoId);
    const id = execBloco(projetoId, 'b1').id;
    assert.throws(() => submeterEntrega(banco, id, 123), /entrega inválida/);
    assert.equal(estadoDe(projetoId, 'b1'), 'em_curso');
  });

  it('entrega válida conclui o bloco e fica registada com linhagem', () => {
    const projetoId = criarProjetoTitulo();
    avancar(banco, projetoId);
    const id = execBloco(projetoId, 'b1').id;
    const bloco = submeterEntrega(banco, id, 'Um título incrível', 'Joana');
    assert.equal(bloco.estado, 'concluido');
    const entregas = banco.listarEntregas(projetoId);
    assert.equal(entregas.length, 1);
    assert.equal(entregas[0].valor, 'Um título incrível');
    assert.equal(entregas[0].tentativa, 2);
    assert.equal(entregas[0].execBlocoId, id);
  });

  it('avancar leva o VALIDAR diretamente a aguardar_aprovacao', () => {
    const projetoId = criarProjetoTitulo();
    avancar(banco, projetoId);
    submeterEntrega(banco, execBloco(projetoId, 'b1').id, 'Um título incrível');
    const r = avancar(banco, projetoId);
    assert.equal(r.acao, 'bloco_iniciado');
    assert.equal(r.execBloco?.blocoId, 'b2');
    assert.equal(r.execBloco?.estado, 'aguardar_aprovacao');
  });

  it('avancar com VALIDAR por aprovar devolve aguarda_intervencao (não salta o veredito)', () => {
    const projetoId = criarProjetoTitulo();
    avancar(banco, projetoId);
    submeterEntrega(banco, execBloco(projetoId, 'b1').id, 'Um título incrível');
    avancar(banco, projetoId); // b2 → aguardar_aprovacao
    const r = avancar(banco, projetoId);
    assert.equal(r.acao, 'aguarda_intervencao');
    assert.equal(r.execBloco?.blocoId, 'b2');
    assert.equal(estadoDe(projetoId, 'b2'), 'aguardar_aprovacao');
  });

  it('aprovar conclui o VALIDAR', () => {
    const projetoId = criarProjetoTitulo();
    avancar(banco, projetoId);
    submeterEntrega(banco, execBloco(projetoId, 'b1').id, 'Um título incrível');
    avancar(banco, projetoId);
    const bloco = aprovar(banco, execBloco(projetoId, 'b2').id, { autor: 'Joana', comentario: 'Bom título' });
    assert.equal(bloco.estado, 'concluido');
  });

  it('avancar com tudo concluído marca o projeto como concluído', () => {
    const projetoId = criarProjetoTitulo();
    avancar(banco, projetoId);
    submeterEntrega(banco, execBloco(projetoId, 'b1').id, 'Um título incrível');
    avancar(banco, projetoId);
    aprovar(banco, execBloco(projetoId, 'b2').id);
    concluirBlocosTriviais(projetoId);
    const r = avancar(banco, projetoId);
    assert.equal(r.acao, 'projeto_concluido');
    assert.equal(estadoProjeto(banco, projetoId).projeto.estado, 'concluido');
    // Idempotente: voltar a avançar num projeto concluído não faz nada.
    assert.equal(avancar(banco, projetoId).acao, 'projeto_concluido');
  });
});

describe('rejeição do VALIDAR', () => {
  it('rejeitar sem voltarParaBlocoId deixa só o VALIDAR pendente', () => {
    const projetoId = criarProjetoTitulo();
    avancar(banco, projetoId);
    submeterEntrega(banco, execBloco(projetoId, 'b1').id, 'Título fraco');
    avancar(banco, projetoId);
    const bloco = rejeitar(banco, execBloco(projetoId, 'b2').id, { autor: 'Joana', comentario: 'Fraco' });
    assert.equal(bloco.estado, 'pendente');
    assert.equal(estadoDe(projetoId, 'b1'), 'concluido');
  });

  it('rejeitar com voltarParaBlocoId devolve o bloco anterior a pendente com tentativa+1', () => {
    const projetoId = criarProjetoTitulo();
    avancar(banco, projetoId);
    submeterEntrega(banco, execBloco(projetoId, 'b1').id, 'Título fraco');
    avancar(banco, projetoId);
    rejeitar(banco, execBloco(projetoId, 'b2').id, { autor: 'Joana', voltarParaBlocoId: 'b1' });
    const b1 = execBloco(projetoId, 'b1');
    assert.equal(b1.estado, 'pendente');
    assert.equal(b1.tentativa, 3); // 1 inicial + 1 do arranque + 1 da rejeição
    assert.equal(estadoDe(projetoId, 'b2'), 'pendente');
  });

  it('rejeitar com voltarParaBlocoId inexistente lança erro claro', () => {
    const projetoId = criarProjetoTitulo();
    avancar(banco, projetoId);
    submeterEntrega(banco, execBloco(projetoId, 'b1').id, 'Título fraco');
    avancar(banco, projetoId);
    assert.throws(
      () => rejeitar(banco, execBloco(projetoId, 'b2').id, { voltarParaBlocoId: 'xx' }),
      /não encontrado/,
    );
    // O VALIDAR já tinha voltado a pendente antes do erro no bloco anterior.
    assert.equal(estadoDe(projetoId, 'b2'), 'pendente');
  });

  it('nova ronda após rejeição conclui o projeto', () => {
    const projetoId = criarProjetoTitulo();
    avancar(banco, projetoId);
    submeterEntrega(banco, execBloco(projetoId, 'b1').id, 'Título fraco');
    avancar(banco, projetoId);
    rejeitar(banco, execBloco(projetoId, 'b2').id, { voltarParaBlocoId: 'b1' });
    // Nova ronda do b1…
    assert.equal(avancar(banco, projetoId).execBloco?.blocoId, 'b1');
    submeterEntrega(banco, execBloco(projetoId, 'b1').id, 'Título muito melhor');
    // …nova ronda do VALIDAR…
    assert.equal(avancar(banco, projetoId).execBloco?.estado, 'aguardar_aprovacao');
    aprovar(banco, execBloco(projetoId, 'b2').id);
    concluirBlocosTriviais(projetoId);
    // …projeto concluído.
    assert.equal(avancar(banco, projetoId).acao, 'projeto_concluido');
    assert.equal(estadoProjeto(banco, projetoId).projeto.estado, 'concluido');
  });
});

describe('blocos automáticos (ia/codigo)', () => {
  function criarProjetoIA(): number {
    const canalId = criarCanal(banco, 'Canal IA', [
      { id: 'c1', tipo: 'CRIAR', operador: 'ia', titulo: 'Gerar título com IA' },
    ]);
    return criarProjeto(banco, canalId, 'Projeto IA').projeto.id;
  }

  it('bloco ia cria job e fica em_curso (sem executor real no M1)', () => {
    const projetoId = criarProjetoIA();
    const r = avancar(banco, projetoId);
    assert.equal(r.acao, 'bloco_iniciado');
    assert.equal(r.execBloco?.estado, 'em_curso');
    assert.equal(r.execBloco?.tentativa, 2);
  });

  it('avancar não inicia outro bloco enquanto houver um em curso', () => {
    const projetoId = criarProjetoIA();
    avancar(banco, projetoId);
    const r = avancar(banco, projetoId);
    assert.equal(r.acao, 'aguarda_intervencao');
    assert.equal(r.execBloco?.blocoId, 'c1');
  });

  it('submeterEntrega num bloco ia é recusada sem mudar o estado', () => {
    const projetoId = criarProjetoIA();
    avancar(banco, projetoId);
    assert.throws(() => submeterEntrega(banco, execBloco(projetoId, 'c1').id, 'texto'), /só em blocos humanos/);
    assert.equal(estadoDe(projetoId, 'c1'), 'em_curso');
  });
});

describe('falhar, repetir, cancelar, retomar', () => {
  function novoProjetoFalhas(): { projetoId: number; id: number } {
    const canalId = criarCanal(banco, 'Canal falhas', [
      { id: 'f1', tipo: 'CRIAR', operador: 'codigo', titulo: 'Correr script' },
    ]);
    const projetoId = criarProjeto(banco, canalId, 'Projeto falhas').projeto.id;
    avancar(banco, projetoId); // f1 → em_curso, tentativa 2
    return { projetoId, id: execBloco(projetoId, 'f1').id };
  }

  it('falhar regista o erro e vai a falhou', () => {
    const { projetoId, id } = novoProjetoFalhas();
    const bloco = falhar(banco, id, 'extensão indisponível');
    assert.equal(bloco.estado, 'falhou');
    assert.equal(bloco.erro, 'extensão indisponível');
    assert.equal(estadoDe(projetoId, 'f1'), 'falhou');
  });

  it('avancar com bloco falhado devolve aguarda_intervencao', () => {
    const { projetoId, id } = novoProjetoFalhas();
    falhar(banco, id, 'boom');
    const r = avancar(banco, projetoId);
    assert.equal(r.acao, 'aguarda_intervencao');
    assert.equal(r.execBloco?.blocoId, 'f1');
  });

  it('repetir volta a pendente com tentativa+1 e limpa o erro', () => {
    const { projetoId, id } = novoProjetoFalhas();
    falhar(banco, id, 'boom');
    const bloco = repetir(banco, id);
    assert.equal(bloco.estado, 'pendente');
    assert.equal(bloco.tentativa, 3);
    assert.equal(bloco.erro, null);
    assert.equal(estadoDe(projetoId, 'f1'), 'pendente');
  });

  it('cancelar vai a cancelado e retomar volta a pendente com tentativa+1', () => {
    const { projetoId, id } = novoProjetoFalhas();
    assert.equal(cancelar(banco, id).estado, 'cancelado');
    const retomado = retomar(banco, id);
    assert.equal(retomado.estado, 'pendente');
    assert.equal(retomado.tentativa, 3);
    assert.equal(estadoDe(projetoId, 'f1'), 'pendente');
  });

  it('cancelar a partir de falhou também é válido', () => {
    const { id } = novoProjetoFalhas();
    falhar(banco, id, 'boom');
    assert.equal(cancelar(banco, id).estado, 'cancelado');
  });
});

describe('transições inválidas não corrompem o estado', () => {
  it('aprovar fora de aguardar_aprovacao lança e não muda o estado', () => {
    const projetoId = criarProjetoTitulo();
    avancar(banco, projetoId);
    const id = execBloco(projetoId, 'b1').id; // em_curso
    assert.throws(() => aprovar(banco, id), /não é possível aprovar/);
    assert.equal(estadoDe(projetoId, 'b1'), 'em_curso');
  });

  it('rejeitar fora de aguardar_aprovacao lança e não muda o estado', () => {
    const projetoId = criarProjetoTitulo();
    const id = execBloco(projetoId, 'b1').id; // pendente
    assert.throws(() => rejeitar(banco, id), /não é possível rejeitar/);
    assert.equal(estadoDe(projetoId, 'b1'), 'pendente');
  });

  it('repetir num bloco concluído lança e não muda o estado', () => {
    const projetoId = criarProjetoTitulo();
    avancar(banco, projetoId);
    const id = execBloco(projetoId, 'b1').id;
    submeterEntrega(banco, id, 'Título');
    assert.throws(() => repetir(banco, id), /transição inválida/);
    assert.equal(estadoDe(projetoId, 'b1'), 'concluido');
  });

  it('submeterEntrega num VALIDAR lança e não muda o estado', () => {
    const projetoId = criarProjetoTitulo();
    avancar(banco, projetoId);
    submeterEntrega(banco, execBloco(projetoId, 'b1').id, 'Título');
    avancar(banco, projetoId);
    const id = execBloco(projetoId, 'b2').id; // aguardar_aprovacao
    assert.throws(() => submeterEntrega(banco, id, 'x'), /VALIDAR/);
    assert.equal(estadoDe(projetoId, 'b2'), 'aguardar_aprovacao');
  });

  it('bloco humano sem saídas declaradas aceita qualquer valor', () => {
    const canalId = criarCanal(banco, 'Canal livre', [
      { id: 'l1', tipo: 'CRIAR', operador: 'humano', titulo: 'Bloco livre' },
    ]);
    const projetoId = criarProjeto(banco, canalId, 'Projeto livre').projeto.id;
    avancar(banco, projetoId);
    const bloco = submeterEntrega(banco, execBloco(projetoId, 'l1').id, 42);
    assert.equal(bloco.estado, 'concluido');
  });

  it('operar sobre bloco ou projeto inexistente lança erro claro', () => {
    assert.throws(() => aprovar(banco, 999999), /não encontrado/);
    assert.throws(() => estadoProjeto(banco, 999999), /não encontrado/);
  });
});

// Licensed under the Business Source License 1.1 — see LICENSE

// Testes de `concluirEntregaAutomatica` (service.ts) sobre o banco real
// `abrirBanco(':memory:')`. Ao contrário do executor, esta função só usa
// métodos do `Banco` já existentes, por isso não precisa de duplos.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBanco, type Banco } from '../db/index.js';
import { avancar, concluirEntregaAutomatica, criarProjeto } from './service.js';

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

// Cria projeto, avança o primeiro bloco do 'tema' e devolve o seu id de
// execução (fica em 'em_curso').
function arrancarBlocoTema(banco: Banco, blocosTema: BlocoDef[]): number {
  const canalId = criarCanal(banco, 'Canal', blocosTema);
  const projeto = criarProjeto(banco, canalId, 'Projeto');
  const resultado = avancar(banco, projeto.projeto.id);
  assert.equal(resultado.acao, 'bloco_iniciado');
  const execBloco = resultado.execBloco;
  assert.ok(execBloco);
  assert.equal(execBloco.estado, 'em_curso');
  return execBloco.id;
}

let banco: Banco;

beforeEach(() => {
  banco = abrirBanco(':memory:');
});

describe('concluirEntregaAutomatica', () => {
  it('caminho feliz: valida, regista a entrega e conclui o bloco', () => {
    const id = arrancarBlocoTema(banco, [
      { id: 'b1', tipo: 'CRIAR', operador: 'ia', titulo: 'Gerar texto', saidas: [SAIDA_TEXTO] },
    ]);
    const bloco = concluirEntregaAutomatica(banco, id, [{ tipo: SAIDA_TEXTO, valor: 'Olá mundo' }]);
    assert.equal(bloco.estado, 'concluido');
    const entregas = banco.listarEntregas(bloco.projetoId);
    assert.equal(entregas.length, 1);
    assert.equal(entregas[0]?.valor, 'Olá mundo');
    assert.deepEqual(entregas[0]?.tipo, SAIDA_TEXTO);
  });

  it('várias saídas: casa por ordem (itens[i] com saidas[i])', () => {
    const SAIDA_NUMERO = {
      chave: 'quantidade',
      tipo: { tipo: 'controlo', controlo: 'numero', cardinalidade: 'um' },
    };
    const id = arrancarBlocoTema(banco, [
      { id: 'b1', tipo: 'CRIAR', operador: 'codigo', titulo: 'Gerar par', saidas: [SAIDA_TEXTO, SAIDA_NUMERO] },
    ]);
    const bloco = concluirEntregaAutomatica(banco, id, [
      { tipo: SAIDA_TEXTO, valor: 'texto' },
      { tipo: SAIDA_NUMERO, valor: 3 },
    ]);
    assert.equal(bloco.estado, 'concluido');
    const entregas = banco.listarEntregas(bloco.projetoId);
    assert.equal(entregas.length, 2);
    assert.deepEqual(
      entregas.map((e) => e.valor),
      ['texto', 3],
    );
  });

  it('nº de itens diferente do nº de saídas → lança sem tocar no estado', () => {
    const id = arrancarBlocoTema(banco, [
      { id: 'b1', tipo: 'CRIAR', operador: 'ia', titulo: 'Gerar texto', saidas: [SAIDA_TEXTO] },
    ]);
    assert.throws(
      () => concluirEntregaAutomatica(banco, id, [
        { tipo: SAIDA_TEXTO, valor: 'um' },
        { tipo: SAIDA_TEXTO, valor: 'dois' },
      ]),
      /declara 1 saída\(s\)/,
    );
    assert.throws(() => concluirEntregaAutomatica(banco, id, []), /declara 1 saída\(s\)/);
    const bloco = banco.obterExecBloco(id);
    assert.equal(bloco?.estado, 'em_curso');
    assert.equal(banco.listarEntregas(bloco?.projetoId ?? -1).length, 0);
  });

  it('valor inválido → lança sem mudar o estado nem registar entregas', () => {
    const id = arrancarBlocoTema(banco, [
      { id: 'b1', tipo: 'CRIAR', operador: 'ia', titulo: 'Gerar texto', saidas: [SAIDA_TEXTO] },
    ]);
    assert.throws(() => concluirEntregaAutomatica(banco, id, [{ tipo: SAIDA_TEXTO, valor: 123 }]), /entrega inválida/);
    const bloco = banco.obterExecBloco(id);
    assert.equal(bloco?.estado, 'em_curso');
    assert.equal(banco.listarEntregas(bloco?.projetoId ?? -1).length, 0);
  });

  it('saída declarada com forma irreconhecível → lança sem tocar no estado', () => {
    const id = arrancarBlocoTema(banco, [
      {
        id: 'b1',
        tipo: 'CRIAR',
        operador: 'ia',
        titulo: 'Gerar texto',
        saidas: [{ chave: 'x', tipo: { tipo: 'desconhecido' } }],
      },
    ]);
    assert.throws(
      () => concluirEntregaAutomatica(banco, id, [{ tipo: { tipo: 'desconhecido' }, valor: 'v' }]),
      /forma inválida/,
    );
    assert.equal(banco.obterExecBloco(id)?.estado, 'em_curso');
  });

  it('bloco humano → lança (entregas manuais são via submeterEntrega)', () => {
    const id = arrancarBlocoTema(banco, [
      { id: 'b1', tipo: 'CRIAR', operador: 'humano', titulo: 'Escrever texto', saidas: [SAIDA_TEXTO] },
    ]);
    assert.throws(() => concluirEntregaAutomatica(banco, id, [{ tipo: SAIDA_TEXTO, valor: 'v' }]), /só em blocos 'ia'\/'codigo'/);
    assert.equal(banco.obterExecBloco(id)?.estado, 'em_curso');
  });

  it('bloco VALIDAR → lança', () => {
    const canalId = criarCanal(banco, 'Canal', [{ id: 'v1', tipo: 'VALIDAR', operador: 'humano', titulo: 'V' }]);
    const projeto = criarProjeto(banco, canalId, 'Projeto');
    const resultado = avancar(banco, projeto.projeto.id);
    const id = resultado.execBloco?.id;
    assert.ok(id);
    assert.equal(banco.obterExecBloco(id)?.estado, 'aguardar_aprovacao');
    assert.throws(() => concluirEntregaAutomatica(banco, id, []), /é VALIDAR/);
  });

  it('bloco que não está em_curso → lança', () => {
    const canalId = criarCanal(banco, 'Canal', [
      { id: 'b1', tipo: 'CRIAR', operador: 'ia', titulo: 'Primeiro', saidas: [SAIDA_TEXTO] },
      { id: 'b2', tipo: 'CRIAR', operador: 'ia', titulo: 'Segundo', saidas: [SAIDA_TEXTO] },
    ]);
    const projeto = criarProjeto(banco, canalId, 'Projeto');
    avancar(banco, projeto.projeto.id); // b1 fica em_curso; b2 continua pendente
    const b2 = banco.obterExecBlocoPorBlocoId(projeto.projeto.id, 'b2');
    assert.ok(b2);
    assert.equal(b2.estado, 'pendente');
    assert.throws(
      () => concluirEntregaAutomatica(banco, b2.id, [{ tipo: SAIDA_TEXTO, valor: 'v' }]),
      /esperado 'em_curso'/,
    );
  });

  it('bloco inexistente → lança', () => {
    assert.throws(() => concluirEntregaAutomatica(banco, 9999, []), /não encontrado/);
  });
});

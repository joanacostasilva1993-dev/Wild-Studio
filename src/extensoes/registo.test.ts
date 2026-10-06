// Licensed under the Business Source License 1.1 — see LICENSE

/**
 * Testes do registo de extensões (protocolo v1).
 *
 * Cobrem o ciclo de vida completo: instalar (válida, copia e regista
 * como INATIVA) → consentir → ativa → resolverCapacidade (ausente,
 * inativa, nenhuma compatível, ambígua, exata) → remover. Usam pastas
 * temporárias reais e SQLite em memória.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirBanco, type Banco } from '../db/index.js';
import { RegistoExtensoes } from './registo.js';

const TEXTO_UM = {
  tipo: 'conteudo',
  familia: 'texto',
  cardinalidade: 'um',
  representacao: 'embutido',
};

function capacidadeBase(sobrescrever: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'gerar-titulos',
    operador: 'ia',
    blocosCompativeis: ['CRIAR'],
    processosCompativeis: ['titulo'],
    entradas: [{ chave: 'tema', tipo: TEXTO_UM }],
    saidas: [{ chave: 'titulos', tipo: { ...TEXTO_UM, cardinalidade: 'varios' } }],
    efeitos: ['leitura_externa'],
    custo: { modelo: 'medido' },
    politicaDados: { enviaParaTerceiros: true, fornecedores: ['fornecedor-llm'] },
    ...sobrescrever,
  };
}

function manifestoBase(sobrescrever: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    apiVersion: '1',
    id: 'exemplo.titulos-ia',
    nome: 'Títulos IA',
    versao: '0.1.0',
    autor: 'Wild Studio',
    licenca: 'BSL-1.1',
    runtime: { tipo: 'modulo', entrada: 'mao.js', exportacao: 'executar' },
    capacidades: [capacidadeBase()],
    ...sobrescrever,
  };
}

let banco: Banco;
let registo: RegistoExtensoes;
let dirTrabalho: string;
let dirDestino: string;

beforeEach(() => {
  banco = abrirBanco();
  registo = new RegistoExtensoes(banco);
  dirTrabalho = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-ext-'));
  dirDestino = path.join(dirTrabalho, 'destino');
});

afterEach(() => {
  banco.fechar();
  fs.rmSync(dirTrabalho, { recursive: true, force: true });
});

/** Cria uma pasta de origem com extensao.json (+ ficheiro de runtime fictício). */
function criarFonte(id: string, manifesto: Record<string, unknown>): string {
  const origem = path.join(dirTrabalho, `fonte-${id}`);
  fs.mkdirSync(origem, { recursive: true });
  fs.writeFileSync(path.join(origem, 'extensao.json'), JSON.stringify(manifesto, null, 2), 'utf-8');
  fs.writeFileSync(path.join(origem, 'mao.js'), 'export function executar() {}', 'utf-8');
  return origem;
}

describe('instalar', () => {
  it('valida, copia a pasta e regista como INATIVA com nota de consentimento', () => {
    const origem = criarFonte('titulos', manifestoBase());
    const resultado = registo.instalar(origem, dirDestino);

    assert.equal(resultado.manifesto.id, 'exemplo.titulos-ia');
    assert.equal(resultado.resumo.id, 'exemplo.titulos-ia');
    assert.equal(resultado.resumo.capacidades.length, 1);
    assert.match(resultado.nota, /INATIVA/);
    assert.match(resultado.nota, /definirConsentimento/);

    // Pasta copiada para <dirDestino>/<id>, com o manifesto e o runtime.
    const destino = path.join(dirDestino, 'exemplo.titulos-ia');
    assert.ok(fs.existsSync(path.join(destino, 'extensao.json')));
    assert.ok(fs.existsSync(path.join(destino, 'mao.js')));

    // Registo no banco: ativa=false.
    const obtida = registo.obter('exemplo.titulos-ia');
    assert.ok(obtida);
    assert.equal(obtida?.nome, 'Títulos IA');
    assert.equal(obtida?.versao, '0.1.0');
    assert.equal(obtida?.caminho, destino);
    assert.equal(obtida?.ativa, false);
    assert.equal(obtida?.notaConsentimento, null);
    assert.equal(typeof obtida?.instaladaEm, 'string');
    assert.equal(obtida?.capacidades.length, 1);
    assert.equal(obtida?.capacidades[0].id, 'gerar-titulos');
  });

  it('rejeita instalar duas vezes o mesmo id', () => {
    registo.instalar(criarFonte('titulos', manifestoBase()), dirDestino);
    assert.throws(
      () => registo.instalar(criarFonte('titulos', manifestoBase()), dirDestino),
      /já está instalada/,
    );
  });

  it('rejeita pasta sem extensao.json', () => {
    const origem = path.join(dirTrabalho, 'fonte-vazia');
    fs.mkdirSync(origem, { recursive: true });
    assert.throws(() => registo.instalar(origem, dirDestino), /extensao\.json/);
  });

  it('rejeita manifesto com JSON inválido', () => {
    const origem = path.join(dirTrabalho, 'fonte-ma');
    fs.mkdirSync(origem, { recursive: true });
    fs.writeFileSync(path.join(origem, 'extensao.json'), '{ não é json', 'utf-8');
    assert.throws(() => registo.instalar(origem, dirDestino), /JSON válido/);
  });

  it('rejeita manifesto inválido e não copia nada', () => {
    const origem = criarFonte('ma', manifestoBase({ id: 'ID MAIÚSCULO' }));
    assert.throws(() => registo.instalar(origem, dirDestino), /Manifesto de extensão inválido/);
    assert.ok(!fs.existsSync(dirDestino));
    assert.equal(registo.listar().length, 0);
  });
});

describe('listar / obter / definirConsentimento', () => {
  it('lista extensões instaladas e obter devolve undefined para id ausente', () => {
    assert.deepEqual(registo.listar(), []);
    assert.equal(registo.obter('inexistente'), undefined);

    registo.instalar(criarFonte('a', manifestoBase({ id: 'ext.a', nome: 'A' })), dirDestino);
    registo.instalar(
      criarFonte('b', manifestoBase({ id: 'ext.b', nome: 'B', versao: '2.0.0' })),
      dirDestino,
    );

    const lista = registo.listar();
    assert.equal(lista.length, 2);
    assert.deepEqual(
      lista.map((e) => e.id),
      ['ext.a', 'ext.b'],
    );
    assert.equal(lista[1].versao, '2.0.0');
    assert.ok(lista.every((e) => e.ativa === false));
    assert.ok(lista.every((e) => Array.isArray(e.capacidades)));
  });

  it('consentir ativa a extensão e guarda a nota; revogar desativa', () => {
    registo.instalar(criarFonte('titulos', manifestoBase()), dirDestino);

    registo.definirConsentimento('exemplo.titulos-ia', true, 'revisto por Joana em 2026-10-06');
    const ativa = registo.obter('exemplo.titulos-ia');
    assert.equal(ativa?.ativa, true);
    assert.equal(ativa?.notaConsentimento, 'revisto por Joana em 2026-10-06');

    // Sem nota nova, a nota anterior mantém-se.
    registo.definirConsentimento('exemplo.titulos-ia', false);
    const inativa = registo.obter('exemplo.titulos-ia');
    assert.equal(inativa?.ativa, false);
    assert.equal(inativa?.notaConsentimento, 'revisto por Joana em 2026-10-06');
  });

  it('definirConsentimento lança para extensão ausente', () => {
    assert.throws(() => registo.definirConsentimento('fantasma', true), /não está instalada/);
  });
});

describe('remover', () => {
  it('apaga a pasta e as linhas do banco', () => {
    registo.instalar(criarFonte('titulos', manifestoBase()), dirDestino);
    const destino = path.join(dirDestino, 'exemplo.titulos-ia');
    assert.ok(fs.existsSync(destino));

    registo.remover('exemplo.titulos-ia');

    assert.ok(!fs.existsSync(destino));
    assert.equal(registo.obter('exemplo.titulos-ia'), undefined);
    assert.deepEqual(registo.listar(), []);
    assert.deepEqual(banco.obterCapacidades('exemplo.titulos-ia'), []);
  });

  it('lança para extensão ausente', () => {
    assert.throws(() => registo.remover('fantasma'), /não está instalada/);
  });

  it('permite reinstalar depois de remover', () => {
    const origem = criarFonte('titulos', manifestoBase());
    registo.instalar(origem, dirDestino);
    registo.remover('exemplo.titulos-ia');
    const resultado = registo.instalar(origem, dirDestino);
    assert.equal(resultado.manifesto.id, 'exemplo.titulos-ia');
    assert.equal(registo.obter('exemplo.titulos-ia')?.ativa, false);
  });
});

describe('resolverCapacidade', () => {
  const criterio = { operador: 'ia' as const, tipoBloco: 'CRIAR' as const, processo: 'titulo' as const };

  it('lança se a extensão não estiver instalada', () => {
    assert.throws(() => registo.resolverCapacidade('fantasma', criterio), /não está instalada/);
  });

  it('lança se a extensão estiver instalada mas inativa', () => {
    registo.instalar(criarFonte('titulos', manifestoBase()), dirDestino);
    assert.throws(() => registo.resolverCapacidade('exemplo.titulos-ia', criterio), /INATIVA/);
  });

  it('lança se nenhuma capacidade for compatível', () => {
    registo.instalar(criarFonte('titulos', manifestoBase()), dirDestino);
    registo.definirConsentimento('exemplo.titulos-ia', true);
    assert.throws(
      () =>
        registo.resolverCapacidade('exemplo.titulos-ia', {
          operador: 'codigo',
          tipoBloco: 'CRIAR',
          processo: 'titulo',
        }),
      /Nenhuma capacidade/,
    );
    assert.throws(
      () =>
        registo.resolverCapacidade('exemplo.titulos-ia', {
          operador: 'ia',
          tipoBloco: 'CRIAR',
          processo: 'guiao',
        }),
      /Nenhuma capacidade/,
    );
  });

  it('lança em caso de ambiguidade (duas capacidades compatíveis)', () => {
    const manifesto = manifestoBase({
      capacidades: [
        capacidadeBase({ id: 'gerar-a' }),
        capacidadeBase({ id: 'gerar-b', operador: 'ia' }),
      ],
    });
    registo.instalar(criarFonte('titulos', manifesto), dirDestino);
    registo.definirConsentimento('exemplo.titulos-ia', true);
    assert.throws(
      () => registo.resolverCapacidade('exemplo.titulos-ia', criterio),
      /Ambiguidade.*'gerar-a'.*'gerar-b'/,
    );
  });

  it('devolve a capacidade quando há exatamente uma compatível', () => {
    const manifesto = manifestoBase({
      capacidades: [
        capacidadeBase({ id: 'gerar-titulos' }),
        capacidadeBase({
          id: 'executar-codigo',
          operador: 'codigo',
          blocosCompativeis: ['PESQUISAR'],
          processosCompativeis: ['tema'],
        }),
      ],
    });
    registo.instalar(criarFonte('titulos', manifesto), dirDestino);
    registo.definirConsentimento('exemplo.titulos-ia', true);

    const capacidade = registo.resolverCapacidade('exemplo.titulos-ia', criterio);
    assert.equal(capacidade.id, 'gerar-titulos');
    assert.equal(capacidade.operador, 'ia');

    const outra = registo.resolverCapacidade('exemplo.titulos-ia', {
      operador: 'codigo',
      tipoBloco: 'PESQUISAR',
      processo: 'tema',
    });
    assert.equal(outra.id, 'executar-codigo');
  });
});

// Licensed under the Business Source License 1.1 — see LICENSE

// Testes exaustivos da máquina de estados: todas as 54 combinações
// (6 estados × 9 intenções). A tabela `VALIDAS` é a especificação
// independente, escrita a partir de ESPECIFICACAO-MVP.md §5/§6 — não é
// cópia da implementação.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transitar, type Intencao } from './transitions.js';
import type { EstadoExec } from '../db/index.js';

const ESTADOS: EstadoExec[] = [
  'pendente',
  'em_curso',
  'aguardar_aprovacao',
  'concluido',
  'falhou',
  'cancelado',
];

const INTENCOES: Intencao[] = [
  'iniciar',
  'trabalho_concluido',
  'solicitar_aprovacao',
  'aprovar',
  'rejeitar',
  'repetir',
  'falhar',
  'cancelar',
  'retomar',
];

// As 14 combinações válidas: "estado + intenção" → estado seguinte.
// Tudo o resto é inválido e deve devolver erro (sem lançar).
const VALIDAS: Record<string, EstadoExec> = {
  'pendente + iniciar': 'em_curso',
  'em_curso + trabalho_concluido': 'concluido',
  'em_curso + solicitar_aprovacao': 'aguardar_aprovacao',
  'aguardar_aprovacao + aprovar': 'concluido',
  'aguardar_aprovacao + rejeitar': 'pendente',
  'falhou + repetir': 'pendente',
  'em_curso + falhar': 'falhou',
  'aguardar_aprovacao + falhar': 'falhou',
  'pendente + cancelar': 'cancelado',
  'em_curso + cancelar': 'cancelado',
  'aguardar_aprovacao + cancelar': 'cancelado',
  'falhou + cancelar': 'cancelado',
  'cancelado + retomar': 'pendente',
  'falhou + retomar': 'pendente',
};

describe('transitar — tabela total (6 estados × 9 intenções = 54 casos)', () => {
  for (const estado of ESTADOS) {
    for (const intencao of INTENCOES) {
      const chave = `${estado} + ${intencao}`;
      const esperado = VALIDAS[chave];
      if (esperado !== undefined) {
        it(`${chave} → ${esperado}`, () => {
          assert.deepEqual(transitar(estado, intencao), { estado: esperado });
        });
      } else {
        it(`${chave} → erro (sem lançar)`, () => {
          const resultado = transitar(estado, intencao);
          assert.ok('erro' in resultado, 'devia devolver { erro } em vez de lançar');
          assert.ok(
            typeof resultado.erro === 'string' && resultado.erro.length > 0,
            'a mensagem de erro não deve ser vazia',
          );
          assert.match(resultado.erro, new RegExp(estado));
          assert.match(resultado.erro, new RegExp(intencao));
        });
      }
    }
  }

  it('a especificação do teste tem exatamente 14 transições válidas', () => {
    assert.equal(Object.keys(VALIDAS).length, 14);
  });

  it('transitar é pura e determinista', () => {
    assert.deepEqual(transitar('pendente', 'iniciar'), transitar('pendente', 'iniciar'));
    assert.deepEqual(transitar('concluido', 'iniciar'), transitar('concluido', 'iniciar'));
  });

  it('concluido é terminal: nenhuma intenção sai de concluido', () => {
    for (const intencao of INTENCOES) {
      const resultado = transitar('concluido', intencao);
      assert.ok('erro' in resultado, `esperava erro para concluido + ${intencao}`);
    }
  });
});

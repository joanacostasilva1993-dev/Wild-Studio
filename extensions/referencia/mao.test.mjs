// Licensed under the Business Source License 1.1 — see LICENSE

/**
 * Testes da extensão de referência "Títulos de Referência".
 *
 * Corre com `node --test extensions/referencia/mao.test.mjs`
 * (não entra no `npm test`, que só corre `src/**`).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executar } from './mao.js';

const TEMA = 'como organizar a semana';

test('modo mock: gera 5 títulos não vazios a partir do tema', async () => {
  const resposta = await executar({
    entradas: {},
    bloco: { parametros: { tema: TEMA } },
  });
  assert.ok(resposta && typeof resposta === 'object');
  const titulos = resposta.saidas.titulos;
  assert.equal(titulos.length, 5);
  for (const titulo of titulos) {
    assert.equal(typeof titulo, 'string');
    assert.ok(titulo.trim().length > 0, 'título vazio');
    assert.ok(titulo.includes(TEMA), `título não usa o tema: "${titulo}"`);
  }
});

test('modo mock: é determinista para o mesmo tema', async () => {
  const pedido = { entradas: {}, bloco: { parametros: { tema: TEMA } } };
  const a = await executar(pedido);
  const b = await executar(pedido);
  assert.deepEqual(a, b);
});

test('modo mock: o tema também pode vir das entradas', async () => {
  const resposta = await executar({ entradas: { tema: TEMA }, bloco: { parametros: {} } });
  assert.equal(resposta.saidas.titulos.length, 5);
  assert.ok(resposta.saidas.titulos[0].includes(TEMA));
});

test('sem tema no pedido: usa o tema genérico (limitação M2 conhecida)', async () => {
  // O executor ainda não encaminha `parametros` do bloco; a extensão não
  // deve falhar por isso — ver LIMITACOES.md.
  const resposta = await executar({ entradas: {}, bloco: { parametros: {} } });
  assert.equal(resposta.saidas.titulos.length, 5);
  assert.ok(resposta.saidas.titulos.every((t) => t.includes('o teu próximo vídeo')));
});

test('modo real sem chave: lança erro claro (não chama a rede)', async () => {
  const anteriorUrl = process.env.TITULOS_API_URL;
  const anteriorChave = process.env.TITULOS_API_KEY;
  process.env.TITULOS_API_URL = 'https://exemplo.invalid/v1/chat/completions';
  delete process.env.TITULOS_API_KEY;
  try {
    await assert.rejects(
      () => executar({ entradas: {}, bloco: { parametros: { tema: TEMA } } }),
      /TITULOS_API_KEY/,
    );
  } finally {
    if (anteriorUrl === undefined) {
      delete process.env.TITULOS_API_URL;
    } else {
      process.env.TITULOS_API_URL = anteriorUrl;
    }
    if (anteriorChave !== undefined) {
      process.env.TITULOS_API_KEY = anteriorChave;
    }
  }
});

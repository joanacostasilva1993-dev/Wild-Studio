// Licensed under the Business Source License 1.1 — see ../../LICENSE-DRAFT.md

/**
 * Valida `extensao.json` contra o validador real do protocolo v1
 * (`src/extensoes/manifest.ts`) mais asserções específicas da drift-bridge.
 *
 * Corre com: `npx tsx extensions/drift-bridge/validar.mjs`
 * (a partir da raiz do projeto; o tsx interpreta o `.ts` do validador).
 */

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { validarManifesto } from '../../src/extensoes/manifest.ts';

const manifesto = JSON.parse(
  readFileSync(new URL('./extensao.json', import.meta.url), 'utf8'),
);

const v = validarManifesto(manifesto);
assert.equal(v.id, 'wild-studio.drift-bridge');
assert.equal(v.apiVersion, '1');
assert.equal(v.runtime.tipo, 'modulo');
assert.equal(v.runtime.entrada, 'mao.js');
assert.equal(v.runtime.exportacao, 'executar');

const cap = v.capacidades.find((c) => c.id === 'montar-e-exportar');
assert.ok(cap, 'capacidade montar-e-exportar em falta');
assert.equal(cap.operador, 'codigo');
assert.deepEqual(cap.blocosCompativeis, ['CRIAR']);
assert.deepEqual(cap.processosCompativeis, ['edicao']);
assert.deepEqual(
  cap.entradas.map((p) => p.chave),
  ['narracao', 'clips', 'legendas', 'titulo', 'parametros'],
);
assert.deepEqual(cap.saidas.map((p) => p.chave), ['video_final']);
assert.ok(cap.efeitos.includes('execucao_local'));
assert.equal(cap.custo.modelo, 'gratuito');
assert.equal(cap.politicaDados.enviaParaTerceiros, false);

console.log(`manifesto válido: ${v.id} v${v.versao} (${v.capacidades.length} capacidade(s))`);

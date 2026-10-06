// Licensed under the Business Source License 1.1 — see LICENSE

/**
 * Protocolo de extensões (M2): ponte real entre a API e o executor.
 *
 * `criarDepsExecutor()` constrói as dependências que o executor do motor
 * (`src/engine/executor.ts`, `executarJobsPendentes(banco, deps, opcoes)`)
 * espera:
 * - `resolverCapacidade` delega no `RegistoExtensoes` do colega
 *   (`src/extensoes/registo.ts`) e resolve
 *   `moduloCaminho = path.join(ext.caminho, runtime.entrada)`, lendo o
 *   `runtime.entrada` do `extensao.json` da cópia instalada (validado com
 *   o `validarManifesto` do colega — fonte única de verdade do protocolo);
 * - `carregarModulo` faz `import(pathToFileURL(caminho).href)`.
 *
 * Os tipos públicos do protocolo (`RegistoExtensoes`, `Capacidade`,
 * `DepsExecutor`, …) vêm dos módulos dos colegas; este ficheiro só
 * acrescenta a ponte.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Banco } from '../db/index.js';
import type { RegistoExtensoes } from '../extensoes/registo.js';
import { validarManifesto, type CriterioResolucao } from '../extensoes/manifest.js';
import type {
  CapacidadeResolvida,
  CriterioCapacidade,
  DepsExecutor,
  OpcoesExecutor,
  ResumoExecucao,
} from '../engine/executor.js';

export type { DepsExecutor, CapacidadeResolvida, CriterioCapacidade };
export type { RegistoExtensoes };

/** Assinatura de `executarJobsPendentes` (para injeção nos testes). */
export type ExecutarJobsFn = (
  banco: Banco,
  deps: DepsExecutor,
  opcoes?: OpcoesExecutor,
) => Promise<ResumoExecucao>;

/** Lê o `runtime.entrada` do manifesto da cópia instalada da extensão. */
function lerRuntimeEntrada(caminhoExtensao: string, extensaoId: string): string {
  const ficheiro = path.join(caminhoExtensao, 'extensao.json');
  let bruto: unknown;
  try {
    bruto = JSON.parse(fs.readFileSync(ficheiro, 'utf8'));
  } catch {
    throw new Error(
      `Não foi possível ler o manifesto instalado da extensão '${extensaoId}' em '${ficheiro}'.`,
    );
  }
  const manifesto = validarManifesto(bruto);
  return manifesto.runtime.entrada;
}

/**
 * Cria as dependências reais do executor sobre o registo fornecido.
 */
export function criarDepsExecutor(registo: RegistoExtensoes): DepsExecutor {
  return {
    async resolverCapacidade(
      extensaoId: string,
      criterio: CriterioCapacidade,
    ): Promise<CapacidadeResolvida> {
      // O registo lança se a extensão estiver ausente/inativa ou a
      // capacidade for inexistente/ambígua (sem retry: erro de configuração).
      // O critério do executor usa strings livres; o registo exige os
      // literais da gramática — os valores em runtime são sempre válidos.
      const capacidade = registo.resolverCapacidade(
        extensaoId,
        criterio as CriterioResolucao,
      );
      const extensao = registo.obter(extensaoId);
      if (!extensao) {
        throw new Error(`A extensão '${extensaoId}' não está instalada.`);
      }
      const moduloCaminho = path.join(
        extensao.caminho,
        lerRuntimeEntrada(extensao.caminho, extensaoId),
      );
      return {
        extensaoId,
        capacidadeId: capacidade.id,
        moduloCaminho,
        saidas: capacidade.saidas,
        efeitos: capacidade.efeitos,
      };
    },

    async carregarModulo(caminho: string) {
      return import(pathToFileURL(caminho).href);
    },
  };
}

// Licensed under the Business Source License 1.1 — see LICENSE

/**
 * Registo de extensões instaladas (protocolo v1).
 *
 * O registo vive sobre o `Banco`: guarda que extensões estão instaladas,
 * onde, e se o utilizador já deu consentimento explícito para as ativar.
 *
 * Ciclo de vida:
 * 1. `instalar()` — valida o `extensao.json`, copia a pasta para o
 *    diretório de destino e regista a extensão como INATIVA. Uma extensão
 *    acabada de instalar nunca executa nada sozinha.
 * 2. `definirConsentimento(id, true)` — o utilizador revê o
 *    `ResumoConsentimento` e ativa a extensão.
 * 3. `resolverCapacidade()` — o executor usa-a para escolher a
 *    capacidade a invocar; só considera extensões instaladas E ativas.
 * 4. `remover()` — apaga a pasta instalada e as linhas do banco.
 *
 * O registo não executa código de extensões: limita-se a validar,
 * guardar e resolver. A execução é responsabilidade do executor (M2).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Banco } from '../db/index.js';
import {
  resumirManifesto,
  validarManifesto,
  type Capacidade,
  type CriterioResolucao,
  type ManifestoExtensao,
  type ResumoConsentimento,
} from './manifest.js';

/** Vista completa de uma extensão instalada, com capacidades e caminho. */
export interface ExtensaoRegisto {
  id: string;
  nome: string;
  versao: string;
  autor: string;
  licenca: string;
  caminho: string;
  ativa: boolean;
  notaConsentimento: string | null;
  instaladaEm: string;
  capacidades: Capacidade[];
}

/** Resultado de `instalar()`: manifesto, resumo e nota de inatividade. */
export interface ResumoInstalacao {
  manifesto: ManifestoExtensao;
  resumo: ResumoConsentimento;
  nota: string;
}

function mensagemErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

export class RegistoExtensoes {
  private readonly banco: Banco;

  constructor(banco: Banco) {
    this.banco = banco;
  }

  /**
   * Instala uma extensão a partir de uma pasta de origem.
   *
   * Lê e valida `<caminhoOrigem>/extensao.json`; rejeita se o id já
   * estiver instalado; copia a pasta recursivamente para
   * `<dirDestino>/<id>`; regista no banco como INATIVA.
   *
   * A extensão instalada não executa nada até ao consentimento
   * explícito via `definirConsentimento(id, true)`.
   */
  instalar(caminhoOrigem: string, dirDestino: string): ResumoInstalacao {
    const ficheiro = path.join(caminhoOrigem, 'extensao.json');
    let texto: string;
    try {
      texto = fs.readFileSync(ficheiro, 'utf-8');
    } catch {
      throw new Error(
        `Não foi possível ler o manifesto em '${ficheiro}': a pasta de origem tem de conter um ficheiro 'extensao.json'.`,
      );
    }
    let bruto: unknown;
    try {
      bruto = JSON.parse(texto);
    } catch {
      throw new Error(`O manifesto em '${ficheiro}' não é JSON válido.`);
    }
    const manifesto = validarManifesto(bruto);

    if (this.banco.obterExtensao(manifesto.id)) {
      throw new Error(
        `A extensão '${manifesto.id}' já está instalada. Remova-a primeiro se quiser reinstalá-la.`,
      );
    }

    const destino = path.join(dirDestino, manifesto.id);
    if (fs.existsSync(destino)) {
      throw new Error(
        `A pasta de destino '${destino}' já existe sem registo no banco. Apague-a manualmente antes de instalar.`,
      );
    }
    fs.mkdirSync(dirDestino, { recursive: true });
    try {
      fs.cpSync(caminhoOrigem, destino, { recursive: true });
    } catch (erro) {
      throw new Error(
        `Falha ao copiar a extensão '${manifesto.id}' para '${destino}': ${mensagemErro(erro)}`,
      );
    }

    // Regista no banco; se falhar, desfaz a cópia para não deixar lixo.
    try {
      this.banco.instalarExtensao({
        id: manifesto.id,
        nome: manifesto.nome,
        versao: manifesto.versao,
        autor: manifesto.autor,
        licenca: manifesto.licenca,
        caminho: destino,
      });
      this.banco.guardarCapacidades(
        manifesto.id,
        manifesto.capacidades.map((c) => ({ id: c.id, definicao: c })),
      );
    } catch (erro) {
      fs.rmSync(destino, { recursive: true, force: true });
      throw erro;
    }

    return {
      manifesto,
      resumo: resumirManifesto(manifesto),
      nota: 'Extensão instalada mas INATIVA: exige consentimento explícito via definirConsentimento.',
    };
  }

  /** Lista todas as extensões instaladas, com capacidades e caminho. */
  listar(): ExtensaoRegisto[] {
    return this.banco.listarExtensoes().map((e) => {
      const completa = this.obter(e.id);
      if (!completa) {
        throw new Error(
          `Falha interna: a extensão '${e.id}' consta da lista mas não foi encontrada.`,
        );
      }
      return completa;
    });
  }

  /** Obtém uma extensão instalada (com capacidades e caminho), ou undefined. */
  obter(id: string): ExtensaoRegisto | undefined {
    const base = this.banco.obterExtensao(id);
    if (!base) return undefined;
    const capacidades = this.banco
      .obterCapacidades(id)
      .map((c) => c.definicao as Capacidade);
    return { ...base, capacidades };
  }

  /**
   * Regista (ou revoga) o consentimento explícito do utilizador.
   * `nota` é opcional e fica guardada junto ao registo (ex.: quem/quando).
   */
  definirConsentimento(id: string, consentido: boolean, nota?: string): void {
    if (!this.banco.obterExtensao(id)) {
      throw new Error(`A extensão '${id}' não está instalada.`);
    }
    this.banco.definirExtensaoAtiva(id, consentido, nota);
  }

  /**
   * Remove uma extensão: apaga a pasta instalada e as linhas do banco
   * (extensão + capacidades). Lança se o id não estiver instalado.
   */
  remover(id: string): void {
    const registo = this.obter(id);
    if (!registo) {
      throw new Error(`A extensão '${id}' não está instalada.`);
    }
    fs.rmSync(registo.caminho, { recursive: true, force: true });
    this.banco.removerExtensao(id);
  }

  /**
   * Resolve a capacidade que serve um bloco com o critério dado.
   *
   * Só considera a extensão se estiver instalada E ativa. Devolve a
   * capacidade quando houver exatamente uma compatível; lança erro
   * claro se a extensão estiver ausente ou inativa, se nenhuma
   * capacidade for compatível, ou se houver mais do que uma
   * (ambiguidade — o núcleo não adivinha).
   */
  resolverCapacidade(extensaoId: string, criterio: CriterioResolucao): Capacidade {
    const registo = this.obter(extensaoId);
    if (!registo) {
      throw new Error(`A extensão '${extensaoId}' não está instalada.`);
    }
    if (!registo.ativa) {
      throw new Error(
        `A extensão '${extensaoId}' está instalada mas INATIVA: falta o consentimento explícito (definirConsentimento).`,
      );
    }
    const compativeis = registo.capacidades.filter(
      (c) =>
        c.operador === criterio.operador &&
        c.blocosCompativeis.includes(criterio.tipoBloco) &&
        c.processosCompativeis.includes(criterio.processo),
    );
    if (compativeis.length === 0) {
      throw new Error(
        `Nenhuma capacidade da extensão '${extensaoId}' é compatível com operador '${criterio.operador}', ` +
          `bloco '${criterio.tipoBloco}' e processo '${criterio.processo}'.`,
      );
    }
    if (compativeis.length > 1) {
      const ids = compativeis.map((c) => `'${c.id}'`).join(', ');
      throw new Error(
        `Ambiguidade: ${compativeis.length} capacidades da extensão '${extensaoId}' são compatíveis ` +
          `(${ids}) com operador '${criterio.operador}', bloco '${criterio.tipoBloco}' e processo '${criterio.processo}'.`,
      );
    }
    return compativeis[0];
  }
}

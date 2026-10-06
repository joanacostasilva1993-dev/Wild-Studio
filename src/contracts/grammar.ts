// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * Gramática do método: processos, blocos, operadores e regras de composição.
 *
 * - Oito processos universais (`PROCESSOS`); cada canal define a sua ordem,
 *   congelada no snapshot do projeto.
 * - Quatro blocos (`BLOCOS`): PESQUISAR, ESCOLHER, CRIAR, VALIDAR.
 * - Três operadores (`OPERADORES`): humano, ia, codigo. O operador humano é
 *   sempre válido — o núcleo funciona com zero extensões.
 * - Regras de composição: VALIDAR só aceita operador humano; blocos
 *   `ia`/`codigo` declaram `extensaoId`; ids de bloco únicos por método;
 *   cada canal tem exatamente um método por processo.
 */

import { z } from 'zod';
import { PortaSchema } from './shapes.js';

// ── Vocabulário ────────────────────────────────────────────────────

export const PROCESSOS = [
  'tema',
  'titulo',
  'thumbnail',
  'guiao',
  'narracao',
  'visuais',
  'edicao',
  'publicacao',
] as const;
export type ProcessoId = (typeof PROCESSOS)[number];
export const ProcessoIdSchema = z.enum(PROCESSOS);

export const BLOCOS = ['PESQUISAR', 'ESCOLHER', 'CRIAR', 'VALIDAR'] as const;
export type BlocoTipo = (typeof BLOCOS)[number];
export const BlocoTipoSchema = z.enum(BLOCOS);

export const OPERADORES = ['humano', 'ia', 'codigo'] as const;
export type Operador = (typeof OPERADORES)[number];
export const OperadorSchema = z.enum(OPERADORES);

// ── Bloco ──────────────────────────────────────────────────────────

export const BlocoDefSchema = z.object({
  id: z.string().min(1),
  tipo: BlocoTipoSchema,
  operador: OperadorSchema,
  titulo: z.string().min(1),
  descricao: z.string().optional(),
  entradas: z.array(PortaSchema).default([]),
  saidas: z.array(PortaSchema).default([]),
  parametros: z.record(z.string(), z.unknown()).optional(),
  extensaoId: z.string().min(1).optional(),
}).superRefine((bloco, ctx) => {
  if (bloco.tipo === 'VALIDAR' && bloco.operador !== 'humano') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `bloco '${bloco.id}' é VALIDAR mas usa operador '${bloco.operador}': VALIDAR só aceita operador 'humano'`,
      path: ['operador'],
    });
  }
  if ((bloco.operador === 'ia' || bloco.operador === 'codigo') && !bloco.extensaoId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `bloco '${bloco.id}' usa operador '${bloco.operador}' e tem de declarar 'extensaoId'`,
      path: ['extensaoId'],
    });
  }
});
export type BlocoDef = z.infer<typeof BlocoDefSchema>;

// ── Método ─────────────────────────────────────────────────────────

export const MetodoDefSchema = z.object({
  processo: ProcessoIdSchema,
  versao: z.number().int().positive().optional(),
  blocos: z.array(BlocoDefSchema).min(1),
}).superRefine((metodo, ctx) => {
  const vistos = new Set<string>();
  metodo.blocos.forEach((bloco, i) => {
    if (vistos.has(bloco.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `id de bloco duplicado no método: '${bloco.id}'`,
        path: ['blocos', i, 'id'],
      });
    }
    vistos.add(bloco.id);
  });
});
export type MetodoDef = z.infer<typeof MetodoDefSchema>;

// ── Canal ──────────────────────────────────────────────────────────

export const CanalDefSchema = z.object({
  nome: z.string().min(1),
  ordemProcessos: z.array(ProcessoIdSchema).length(8),
  metodos: z.array(MetodoDefSchema).length(8),
}).superRefine((canal, ctx) => {
  if (new Set(canal.ordemProcessos).size !== canal.ordemProcessos.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "'ordemProcessos' contém processos repetidos",
      path: ['ordemProcessos'],
    });
  }
  const processosMetodos = canal.metodos.map((m) => m.processo);
  if (new Set(processosMetodos).size !== processosMetodos.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "'metodos' contém mais do que um método para o mesmo processo",
      path: ['metodos'],
    });
  }
  const declarados = new Set(processosMetodos);
  const emFalta = PROCESSOS.filter((p) => !declarados.has(p));
  if (emFalta.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `'metodos' não cobre os processos: ${emFalta.join(', ')}`,
      path: ['metodos'],
    });
  }
});
export type CanalDef = z.infer<typeof CanalDefSchema>;

// ── Validação de alto nível ────────────────────────────────────────

/**
 * Valida uma definição de canal. Devolve a lista de erros legíveis
 * (`caminho: mensagem`); lista vazia = definição válida.
 */
export function validarCanal(def: unknown): string[] {
  const resultado = CanalDefSchema.safeParse(def);
  if (resultado.success) return [];
  return resultado.error.issues.map((issue) => {
    const caminho = issue.path.length > 0 ? issue.path.join('.') : '(raiz)';
    return `${caminho}: ${issue.message}`;
  });
}

// Licensed under the Business Source License 1.1 — see LICENSE

/**
 * Protocolo de extensões v1: manifesto `extensao.json`.
 *
 * O manifesto é a única coisa que o núcleo precisa de saber sobre uma
 * extensão antes de a ativar: identificação, runtime, capacidades
 * declaradas (operador, blocos/processos compatíveis, portas tipadas do
 * §4, efeitos externos, custo e política de dados). A validação acontece
 * em duas camadas:
 * - zod (`ManifestoExtensaoSchema`): forma dos campos;
 * - `verificarManifesto()`: regras estruturais que o zod não exprime bem
 *   (ids únicos, chaves de porta únicas, coerência da política de dados).
 *
 * `validarManifesto()` combina as duas e lança `Error` descritivo (em
 * Português Europeu) quando algo falha. `resumirManifesto()` produz o
 * resumo destinado à revisão de consentimento do utilizador.
 *
 * Decisões de desenho (M2):
 * - `runtime.tipo: "modulo"` significa um módulo JavaScript local,
 *   carregado com `import()` dinâmico pelo executor: `entrada` é o
 *   ficheiro relativo à pasta instalada (ex.: "mao.js") e `exportacao`
 *   o nome do símbolo exportado a invocar (ex.: "executar").
 * - Os ids (extensão e capacidade) usam o mesmo formato restrito
 *   (minúsculas, dígitos, `.`, `_`, `-`; 2 a 63 carateres): além de
 *   legíveis, evitam travessias de caminho no nome da pasta de destino.
 */

import { z } from 'zod';
import {
  BlocoTipoSchema,
  PortaSchema,
  ProcessoIdSchema,
  verificarValueShape,
  type BlocoTipo,
  type Operador,
  type ProcessoId,
} from '../contracts/index.js';

/** Id de extensão ou de capacidade: restrito, sem maiúsculas nem espaços. */
const IdExtensaoSchema = z.string().regex(
  /^[a-z0-9][a-z0-9._-]{1,62}$/,
  "o id tem de usar só minúsculas, dígitos, '.', '_' e '-', começar por letra ou dígito e ter entre 2 e 63 carateres",
);

/** Versão no formato X.Y.Z (ex.: "1.2.0"). */
const VersaoSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, "a versão tem de seguir o formato X.Y.Z (ex.: '1.2.0')");

/** Como o núcleo carrega e invoca a extensão. */
export const RuntimeExtensaoSchema = z.object({
  tipo: z.literal('modulo', {
    errorMap: () => ({ message: "o runtime suportado no protocolo v1 é 'modulo'" }),
  }),
  entrada: z.string().min(1, 'o ficheiro de entrada do runtime não pode estar vazio (ex.: "mao.js")'),
  exportacao: z.string().min(1, 'o nome da exportação do runtime não pode estar vazio (ex.: "executar")'),
});
export type RuntimeExtensao = z.infer<typeof RuntimeExtensaoSchema>;

/** Efeitos externos que a capacidade pode produzir. */
export const EfeitoSchema = z.enum(['leitura_externa', 'escrita_externa', 'execucao_local']);
export type Efeito = z.infer<typeof EfeitoSchema>;

/** Modelo de custo da capacidade. */
export const CustoSchema = z.object({
  modelo: z.enum(['gratuito', 'medido', 'fixo']),
  descricao: z.string().optional(),
});
export type Custo = z.infer<typeof CustoSchema>;

/** Política de dados: que dados saem da máquina e para quem. */
export const PoliticaDadosSchema = z.object({
  enviaParaTerceiros: z.boolean(),
  fornecedores: z.array(z.string().min(1)).default([]),
  descricao: z.string().optional(),
});
export type PoliticaDados = z.infer<typeof PoliticaDadosSchema>;

/** Uma capacidade: o que a extensão sabe fazer, com que contrato. */
export const CapacidadeSchema = z.object({
  id: IdExtensaoSchema,
  operador: z.enum(['ia', 'codigo']),
  blocosCompativeis: BlocoTipoSchema.array().min(
    1,
    'a capacidade tem de declarar pelo menos um bloco compatível',
  ),
  processosCompativeis: ProcessoIdSchema.array().min(
    1,
    'a capacidade tem de declarar pelo menos um processo compatível',
  ),
  entradas: z.array(PortaSchema).default([]),
  saidas: z.array(PortaSchema).min(1, 'a capacidade tem de declarar pelo menos uma porta de saída'),
  efeitos: EfeitoSchema.array().default([]),
  custo: CustoSchema,
  politicaDados: PoliticaDadosSchema,
});
export type Capacidade = z.infer<typeof CapacidadeSchema>;

/** Manifesto completo de uma extensão (`extensao.json`). */
export const ManifestoExtensaoSchema = z.object({
  apiVersion: z.literal('1', {
    errorMap: () => ({ message: "a apiVersion tem de ser '1' (protocolo v1)" }),
  }),
  id: IdExtensaoSchema,
  nome: z.string().min(1, 'o nome da extensão não pode estar vazio'),
  versao: VersaoSchema,
  autor: z.string().min(1, 'o autor da extensão não pode estar vazio'),
  licenca: z.string().min(1, 'a licença da extensão não pode estar vazia'),
  runtime: RuntimeExtensaoSchema,
  capacidades: z.array(CapacidadeSchema).min(1, 'a extensão tem de declarar pelo menos uma capacidade'),
});
export type ManifestoExtensao = z.infer<typeof ManifestoExtensaoSchema>;

/** Critério para escolher a capacidade que serve um bloco. */
export interface CriterioResolucao {
  operador: Operador;
  tipoBloco: BlocoTipo;
  processo: ProcessoId;
}

/* ------------------------------------------------------------------ */
/* Regras estruturais                                                 */
/* ------------------------------------------------------------------ */

function verificarChavesPorta(
  capacidadeId: string,
  lado: 'entradas' | 'saidas',
  portas: { chave: string }[],
): string[] {
  const erros: string[] = [];
  const vistas = new Set<string>();
  for (const porta of portas) {
    if (vistas.has(porta.chave)) {
      erros.push(
        `capacidade '${capacidadeId}': chave de porta duplicada em '${lado}': '${porta.chave}'`,
      );
    }
    vistas.add(porta.chave);
  }
  return erros;
}

/**
 * Regras estruturais do manifesto (para além da forma validada pelo zod):
 * - ids de capacidade únicos dentro da extensão;
 * - chaves de porta únicas dentro das entradas e dentro das saídas
 *   (o mesmo nome pode existir nos dois lados — são âmbitos separados);
 * - cada shape de porta volta a passar por `verificarValueShape`
 *   (o zod já o faz via `PortaSchema`; repete-se aqui para manifestos
 *   construídos à mão sem passar pelo schema);
 * - se `politicaDados.enviaParaTerceiros` for `false`, `fornecedores`
 *   tem de estar vazio.
 *
 * Devolve a lista de erros; lista vazia = estrutura válida.
 */
export function verificarManifesto(manifesto: ManifestoExtensao): string[] {
  const erros: string[] = [];
  const capacidadesVistas = new Set<string>();
  for (const capacidade of manifesto.capacidades) {
    if (capacidadesVistas.has(capacidade.id)) {
      erros.push(`capacidade com id duplicado: '${capacidade.id}'`);
    }
    capacidadesVistas.add(capacidade.id);

    erros.push(...verificarChavesPorta(capacidade.id, 'entradas', capacidade.entradas));
    erros.push(...verificarChavesPorta(capacidade.id, 'saidas', capacidade.saidas));

    capacidade.entradas.forEach((porta, i) => {
      for (const e of verificarValueShape(porta.tipo, `capacidade '${capacidade.id}' entradas[${i}]`)) {
        erros.push(e);
      }
    });
    capacidade.saidas.forEach((porta, i) => {
      for (const e of verificarValueShape(porta.tipo, `capacidade '${capacidade.id}' saidas[${i}]`)) {
        erros.push(e);
      }
    });

    const politica = capacidade.politicaDados;
    if (!politica.enviaParaTerceiros && politica.fornecedores.length > 0) {
      erros.push(
        `capacidade '${capacidade.id}': 'enviaParaTerceiros' é false mas 'fornecedores' não está vazio — ` +
          `se nenhum dado sai, não pode haver fornecedores listados`,
      );
    }
  }
  return erros;
}

/**
 * Valida um valor desconhecido como manifesto de extensão.
 * Lança `Error` descritivo (em Português Europeu) se a forma (zod) ou
 * as regras estruturais (`verificarManifesto`) falharem.
 */
export function validarManifesto(desconhecido: unknown): ManifestoExtensao {
  const resultado = ManifestoExtensaoSchema.safeParse(desconhecido);
  if (!resultado.success) {
    const detalhe = resultado.error.issues
      .map((issue) => {
        const caminho = issue.path.length > 0 ? issue.path.join('.') : '(raiz)';
        return `  - ${caminho}: ${issue.message}`;
      })
      .join('\n');
    throw new Error(`Manifesto de extensão inválido:\n${detalhe}`);
  }
  const estruturais = verificarManifesto(resultado.data);
  if (estruturais.length > 0) {
    const detalhe = estruturais.map((e) => `  - ${e}`).join('\n');
    throw new Error(`Manifesto de extensão inválido:\n${detalhe}`);
  }
  return resultado.data;
}

/* ------------------------------------------------------------------ */
/* Resumo para consentimento                                          */
/* ------------------------------------------------------------------ */

/** Vista resumida de uma capacidade, para revisão humana. */
export interface ResumoCapacidade {
  id: string;
  operador: Operador;
  blocosCompativeis: BlocoTipo[];
  processosCompativeis: ProcessoId[];
  efeitos: Efeito[];
  custo: Custo;
  politicaDados: PoliticaDados;
}

/** Vista resumida do manifesto, para a revisão de consentimento. */
export interface ResumoConsentimento {
  id: string;
  nome: string;
  versao: string;
  autor: string;
  licenca: string;
  capacidades: ResumoCapacidade[];
}

/**
 * Extrai do manifesto apenas o que o utilizador precisa de rever antes
 * de dar consentimento: identidade, capacidades, efeitos, custo e
 * política de dados. Devolve cópias (sem aliasing do manifesto).
 */
export function resumirManifesto(m: ManifestoExtensao): ResumoConsentimento {
  return {
    id: m.id,
    nome: m.nome,
    versao: m.versao,
    autor: m.autor,
    licenca: m.licenca,
    capacidades: m.capacidades.map((c) => ({
      id: c.id,
      operador: c.operador,
      blocosCompativeis: [...c.blocosCompativeis],
      processosCompativeis: [...c.processosCompativeis],
      efeitos: [...c.efeitos],
      custo: { ...c.custo },
      politicaDados: {
        ...c.politicaDados,
        fornecedores: [...c.politicaDados.fornecedores],
      },
    })),
  };
}

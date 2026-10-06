// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * Contratos de tipos de valores (shapes): conteúdo, controlos e registos.
 *
 * Um único sistema de tipos para todas as fronteiras (método, motor,
 * extensões, UI). Três variantes, discriminadas por `tipo`:
 * - `conteudo`: quatro famílias (texto|imagem|audio|video) com
 *   cardinalidade (um|varios) e representação (embutido|artefacto|ambos);
 * - `controlo`: valores que não são conteúdo (identificador, numero,
 *   booleano, selecao, datahora, url, aprovacao);
 * - `registo`: estrutura com campos nomeados, cada um com o seu tipo
 *   (conteúdo ou controlo, recursivo). Sem "quinta família".
 *
 * Nota de desenho: o zod não aceita schemas refinados (`.refine()` /
 * `.superRefine()`, que devolvem `ZodEffects`) como membros de
 * `z.discriminatedUnion` — a construção lança exceção. Por isso os três
 * membros da união são objetos puros, e as regras estruturais
 * ("selecao ⇒ opcoes não vazio"; "chaves de campo únicas no registo")
 * vivem em `verificarValueShape()`, aplicada em `PortaSchema` (toda a
 * shape do sistema viaja dentro de uma porta) e disponível para uso
 * direto. `ControlShapeSchema` (refinado) existe para validação direta
 * de controlos isolados.
 */

import { z } from 'zod';

// ── Vocabulário base ───────────────────────────────────────────────

export const FamiliaSchema = z.enum(['texto', 'imagem', 'audio', 'video']);
export type Familia = z.infer<typeof FamiliaSchema>;

export const CardinalidadeSchema = z.enum(['um', 'varios']);
export type Cardinalidade = z.infer<typeof CardinalidadeSchema>;

export const RepresentacaoSchema = z.enum(['embutido', 'artefacto', 'ambos']);
export type Representacao = z.infer<typeof RepresentacaoSchema>;

export const FormatosSchema = z.object({
  mimeTypes: z.array(z.string().min(1)).optional(),
  extensoes: z.array(z.string().min(1)).optional(),
});
export type Formatos = z.infer<typeof FormatosSchema>;

// ── Conteúdo ───────────────────────────────────────────────────────

export const ContentShapeSchema = z.object({
  tipo: z.literal('conteudo'),
  familia: FamiliaSchema,
  cardinalidade: CardinalidadeSchema,
  representacao: RepresentacaoSchema,
  formatos: FormatosSchema.optional(),
});
export type ContentShape = z.infer<typeof ContentShapeSchema>;

// ── Controlos ──────────────────────────────────────────────────────

export const ControloTipoSchema = z.enum([
  'identificador',
  'numero',
  'booleano',
  'selecao',
  'datahora',
  'url',
  'aprovacao',
]);
export type ControloTipo = z.infer<typeof ControloTipoSchema>;

/** Objeto puro: é este o membro da união discriminada `ValueShapeSchema`. */
const ControloBaseSchema = z.object({
  tipo: z.literal('controlo'),
  controlo: ControloTipoSchema,
  cardinalidade: CardinalidadeSchema,
  opcoes: z.array(z.string().min(1)).min(1).optional(),
});
type ControloBase = z.infer<typeof ControloBaseSchema>;

function verificarControlo(c: ControloBase): string[] {
  if (c.controlo === 'selecao' && (!c.opcoes || c.opcoes.length === 0)) {
    return ["controlo 'selecao' exige 'opcoes' com pelo menos uma opção"];
  }
  return [];
}

/** Controlo com refinamento: `selecao` obriga `opcoes` não vazio. */
export const ControlShapeSchema = ControloBaseSchema.superRefine((c, ctx) => {
  for (const erro of verificarControlo(c)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: erro, path: ['opcoes'] });
  }
});
export type ControlShape = z.infer<typeof ControlShapeSchema>;

// ── Registos ───────────────────────────────────────────────────────

export interface CampoRegisto {
  id: string;
  rotulo: string;
  chave: string;
  tipo: ValueShape;
  obrigatorio: boolean;
}

const CampoRegistoSchema: z.ZodType<CampoRegisto> = z.object({
  id: z.string().min(1),
  rotulo: z.string().min(1),
  chave: z.string().min(1),
  tipo: z.lazy((): z.ZodType<ValueShape> => ValueShapeSchema),
  obrigatorio: z.boolean(),
});

export const RecordShapeSchema = z.object({
  tipo: z.literal('registo'),
  cardinalidade: CardinalidadeSchema,
  campos: z.array(CampoRegistoSchema).min(1),
});
export type RecordShape = z.infer<typeof RecordShapeSchema>;

// ── União discriminada ─────────────────────────────────────────────

export const ValueShapeSchema = z.discriminatedUnion('tipo', [
  ContentShapeSchema,
  ControloBaseSchema,
  RecordShapeSchema,
]);
export type ValueShape = z.infer<typeof ValueShapeSchema>;

// ── Regras estruturais (recursivas) ────────────────────────────────

/**
 * Regras que o zod não consegue exprimir dentro da união discriminada:
 * - `selecao` ⇒ `opcoes` obrigatório e não vazio;
 * - chaves de campo únicas dentro de cada registo (recursivo).
 * Devolve a lista de erros; lista vazia = estrutura válida.
 */
export function verificarValueShape(tipo: ValueShape, caminho = ''): string[] {
  const erros: string[] = [];
  const prefixo = caminho ? `${caminho}: ` : '';
  switch (tipo.tipo) {
    case 'controlo':
      for (const e of verificarControlo(tipo)) erros.push(`${prefixo}${e}`);
      break;
    case 'registo': {
      const vistas = new Set<string>();
      for (const campo of tipo.campos) {
        if (vistas.has(campo.chave)) {
          erros.push(`${prefixo}registo com chave de campo duplicada: '${campo.chave}'`);
        }
        vistas.add(campo.chave);
      }
      for (const campo of tipo.campos) {
        const sub = caminho ? `${caminho}.${campo.chave}` : campo.chave;
        erros.push(...verificarValueShape(campo.tipo, sub));
      }
      break;
    }
    case 'conteudo':
      break;
  }
  return erros;
}

// ── Porta ──────────────────────────────────────────────────────────

export const PortaSchema = z.object({
  chave: z.string().min(1),
  rotulo: z.string().optional(),
  tipo: ValueShapeSchema,
  obrigatoria: z.boolean().default(true),
}).superRefine((porta, ctx) => {
  for (const erro of verificarValueShape(porta.tipo, 'tipo')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: erro, path: ['tipo'] });
  }
});
export type Porta = z.infer<typeof PortaSchema>;

// ── Compatibilidade entre portas ───────────────────────────────────

function normalizarMime(mime: string): string {
  return mime.toLowerCase();
}

function normalizarExtensao(ext: string): string {
  return ext.toLowerCase().replace(/^\./, '');
}

/**
 * Formatos compatíveis se: pelo menos um dos lados não declara formatos
 * (sem restrição), ou ambos declaram e há interseção não vazia em
 * mimeTypes ou em extensoes.
 */
function formatosCompativeis(a?: Formatos, b?: Formatos): boolean {
  const mimesA = a?.mimeTypes ?? [];
  const mimesB = b?.mimeTypes ?? [];
  const extsA = a?.extensoes ?? [];
  const extsB = b?.extensoes ?? [];
  const declaraA = mimesA.length > 0 || extsA.length > 0;
  const declaraB = mimesB.length > 0 || extsB.length > 0;
  if (!declaraA || !declaraB) return true;
  const normMimesB = new Set(mimesB.map(normalizarMime));
  const normExtsB = new Set(extsB.map(normalizarExtensao));
  const haMime =
    mimesA.length > 0 &&
    mimesB.length > 0 &&
    mimesA.some((m) => normMimesB.has(normalizarMime(m)));
  const haExt =
    extsA.length > 0 &&
    extsB.length > 0 &&
    extsA.some((e) => normExtsB.has(normalizarExtensao(e)));
  return haMime || haExt;
}

function portaDeCampo(chave: string, tipo: ValueShape, obrigatoria: boolean): Porta {
  return { chave, tipo, obrigatoria };
}

/**
 * Duas portas ligam-se se e só se: mesmo `tipo` e mesma `cardinalidade`;
 * conteúdos com mesma família e representação compatível (iguais, ou uma
 * delas `'ambos'`); formatos com interseção não vazia quando ambos os
 * lados os declaram; controlos do mesmo tipo, com opções compatíveis no
 * caso de `selecao` (todas as opções da entrada existem nas da saída);
 * registos em que cada campo obrigatório da entrada tem campo
 * correspondente na saída com tipo compatível (recursivo).
 *
 * Sem coerção implícita, sem inferência por nomes: `saida` é a porta que
 * produz o valor, `entrada` a que o consome.
 */
export function compativel(saida: Porta, entrada: Porta): boolean {
  const ts = saida.tipo;
  const te = entrada.tipo;
  if (ts.tipo !== te.tipo) return false;
  if (ts.cardinalidade !== te.cardinalidade) return false;
  switch (ts.tipo) {
    case 'conteudo': {
      const ce = te as ContentShape;
      if (ts.familia !== ce.familia) return false;
      const repOk =
        ts.representacao === ce.representacao ||
        ts.representacao === 'ambos' ||
        ce.representacao === 'ambos';
      if (!repOk) return false;
      return formatosCompativeis(ts.formatos, ce.formatos);
    }
    case 'controlo': {
      const ce = te as ControlShape;
      if (ts.controlo !== ce.controlo) return false;
      if (ce.controlo === 'selecao') {
        const opcoesSaida = new Set(ts.opcoes ?? []);
        return (ce.opcoes ?? []).every((op) => opcoesSaida.has(op));
      }
      return true;
    }
    case 'registo': {
      const re = te as RecordShape;
      for (const campoE of re.campos) {
        if (!campoE.obrigatorio) continue;
        const campoS = ts.campos.find((c) => c.chave === campoE.chave);
        if (!campoS) return false;
        const ok = compativel(
          portaDeCampo(campoS.chave, campoS.tipo, campoS.obrigatorio),
          portaDeCampo(campoE.chave, campoE.tipo, campoE.obrigatorio),
        );
        if (!ok) return false;
      }
      return true;
    }
  }
}

// ── Validação de valores ────────────────────────────────────────────

function eObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

interface ReferenciaArtefacto {
  id: string;
  mimeType?: string;
  extensao?: string;
}

/**
 * Um artefacto é referenciado por `{ id: string }`. Campos adicionais
 * (`mimeType`, `extensao`) são tolerados e, quando presentes, validados
 * contra os formatos declarados na shape. Devolve `null` se inválido.
 */
function comoArtefacto(valor: unknown): ReferenciaArtefacto | null {
  if (!eObjeto(valor)) return null;
  if (typeof valor.id !== 'string' || valor.id.length === 0) return null;
  const ref: ReferenciaArtefacto = { id: valor.id };
  if (typeof valor.mimeType === 'string') ref.mimeType = valor.mimeType;
  if (typeof valor.extensao === 'string') ref.extensao = valor.extensao;
  return ref;
}

/**
 * Valida extensão/mime apenas quando o valor declara essa informação
 * (tolerante: o que o valor não declara não é validado).
 */
function validarFormatosDeclarados(
  shape: ContentShape,
  ref: ReferenciaArtefacto,
  caminho: string,
): string[] {
  const erros: string[] = [];
  const f = shape.formatos;
  if (!f) return erros;
  const err = (m: string) => erros.push(caminho ? `${caminho}: ${m}` : m);
  if (ref.mimeType !== undefined && (f.mimeTypes?.length ?? 0) > 0) {
    const permitido = f.mimeTypes!.some((m) => normalizarMime(m) === normalizarMime(ref.mimeType!));
    if (!permitido) err(`mimeType '${ref.mimeType}' fora dos formatos permitidos (${f.mimeTypes!.join(', ')})`);
  }
  if (ref.extensao !== undefined && (f.extensoes?.length ?? 0) > 0) {
    const permitido = f.extensoes!.some((e) => normalizarExtensao(e) === normalizarExtensao(ref.extensao!));
    if (!permitido) err(`extensão '${ref.extensao}' fora dos formatos permitidos (${f.extensoes!.join(', ')})`);
  }
  return erros;
}

function comCaminho(caminho: string, indiceOuChave: string | number): string {
  if (typeof indiceOuChave === 'number') {
    return caminho ? `${caminho}[${indiceOuChave}]` : `[${indiceOuChave}]`;
  }
  return caminho ? `${caminho}.${indiceOuChave}` : indiceOuChave;
}

function validarConteudo(shape: ContentShape, valor: unknown, caminho: string): string[] {
  const erros: string[] = [];
  const err = (m: string) => erros.push(caminho ? `${caminho}: ${m}` : m);

  const validarUm = (v: unknown, c: string): void => {
    const erroEm = (m: string) => erros.push(c ? `${c}: ${m}` : m);
    if (shape.familia === 'texto' && shape.representacao === 'embutido') {
      if (typeof v !== 'string') erroEm('esperava texto (string)');
      return;
    }
    if (shape.familia === 'texto' && shape.representacao === 'ambos') {
      if (typeof v === 'string') return;
      const ref = comoArtefacto(v);
      if (!ref) {
        erroEm('esperava texto (string) ou artefacto ({ id })');
        return;
      }
      erros.push(...validarFormatosDeclarados(shape, ref, c));
      return;
    }
    // Texto artefacto, ou imagem/audio/video (sempre artefactos): { id }.
    const ref = comoArtefacto(v);
    if (!ref) {
      erroEm('esperava um artefacto ({ id: string })');
      return;
    }
    erros.push(...validarFormatosDeclarados(shape, ref, c));
  };

  if (shape.cardinalidade === 'varios') {
    if (!Array.isArray(valor)) {
      err('esperava uma lista de valores');
      return erros;
    }
    valor.forEach((item, i) => validarUm(item, comCaminho(caminho, i)));
  } else {
    validarUm(valor, caminho);
  }
  return erros;
}

function validarControlo(shape: ControlShape, valor: unknown, caminho: string): string[] {
  const erros: string[] = [];
  const err = (m: string) => erros.push(caminho ? `${caminho}: ${m}` : m);

  const validarUm = (v: unknown, c: string): void => {
    const erroEm = (m: string) => erros.push(c ? `${c}: ${m}` : m);
    switch (shape.controlo) {
      case 'numero':
        if (typeof v !== 'number' || !Number.isFinite(v)) erroEm('esperava um número finito');
        break;
      case 'booleano':
        if (typeof v !== 'boolean') erroEm('esperava um booleano (true/false)');
        break;
      case 'identificador':
        if (typeof v !== 'string' || v.length === 0) erroEm('esperava um identificador (texto não vazio)');
        break;
      case 'url':
        if (typeof v !== 'string' || v.length === 0) erroEm('esperava um URL (texto não vazio)');
        break;
      case 'datahora':
        if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) {
          erroEm('esperava uma data/hora em texto ISO (ex.: 2026-10-06T10:00:00Z)');
        }
        break;
      case 'selecao': {
        const opcoes = shape.opcoes ?? [];
        if (typeof v !== 'string' || !opcoes.includes(v)) {
          erroEm(`esperava uma das opções: ${opcoes.join(', ') || '(nenhuma definida)'}`);
        }
        break;
      }
      case 'aprovacao': {
        if (!eObjeto(v)) {
          erroEm("esperava um veredito ({ decisao: 'aprovado' | 'rejeitado' })");
          break;
        }
        if (v.decisao !== 'aprovado' && v.decisao !== 'rejeitado') {
          erroEm("campo 'decisao' tem de ser 'aprovado' ou 'rejeitado'");
        }
        if (v.comentario !== undefined && typeof v.comentario !== 'string') {
          erroEm("campo 'comentario' tem de ser texto");
        }
        break;
      }
    }
  };

  if (shape.cardinalidade === 'varios') {
    if (!Array.isArray(valor)) {
      err('esperava uma lista de valores');
      return erros;
    }
    valor.forEach((item, i) => validarUm(item, comCaminho(caminho, i)));
  } else {
    validarUm(valor, caminho);
  }
  return erros;
}

function validarRegisto(shape: RecordShape, valor: unknown, caminho: string): string[] {
  const erros: string[] = [];
  const err = (m: string) => erros.push(caminho ? `${caminho}: ${m}` : m);

  const validarUm = (v: unknown, c: string): void => {
    const erroEm = (m: string) => erros.push(c ? `${c}: ${m}` : m);
    if (!eObjeto(v)) {
      erroEm('esperava um objeto (registo)');
      return;
    }
    for (const campo of shape.campos) {
      const vv = v[campo.chave];
      if (vv === undefined) {
        if (campo.obrigatorio) erroEm(`campo obrigatório em falta: '${campo.chave}'`);
        continue;
      }
      erros.push(...validarValor(campo.tipo, vv, comCaminho(c, campo.chave)));
    }
  };

  if (shape.cardinalidade === 'varios') {
    if (!Array.isArray(valor)) {
      err('esperava uma lista de registos');
      return erros;
    }
    valor.forEach((item, i) => validarUm(item, comCaminho(caminho, i)));
  } else {
    validarUm(valor, caminho);
  }
  return erros;
}

/**
 * Valida um valor contra a sua shape. Devolve a lista de erros
 * (mensagens em Português Europeu, com caminho); lista vazia = válido.
 * Sem coerção: `'3'` não é `numero`, `1` não é `booleano`.
 */
export function validarValor(tipo: ValueShape, valor: unknown, caminho = ''): string[] {
  switch (tipo.tipo) {
    case 'conteudo':
      return validarConteudo(tipo, valor, caminho);
    case 'controlo':
      return validarControlo(tipo, valor, caminho);
    case 'registo':
      return validarRegisto(tipo, valor, caminho);
  }
}

// Licensed under the Business Source License 1.1 — see LICENSE

/**
 * Camada de acesso à base de dados SQLite (better-sqlite3).
 *
 * Expõe operações de alto nível sobre canais, métodos versionados,
 * projetos (com snapshot imutável), execuções, entregas, aprovações,
 * tentativas, jobs e extensões instaladas. As datas são guardadas em
 * ISO 8601.
 *
 * Notas de integridade:
 * - Entregas, aprovações e tentativas são factos imutáveis: não há
 *   funções de UPDATE/DELETE para essas tabelas nesta camada.
 * - Editar o método de um canal cria uma nova versão; projetos já
 *   criados mantêm o snapshot original (ver criarProjeto).
 * - Chaves estrangeiras são aplicadas na ligação (PRAGMA foreign_keys).
 */

import Database from 'better-sqlite3';
import { DDL } from './schema.js';
import type { Porta } from '../contracts/index.js';

/** Estados possíveis de uma execução de bloco ou de processo. */
export type EstadoExec =
  | 'pendente'
  | 'em_curso'
  | 'aguardar_aprovacao'
  | 'concluido'
  | 'falhou'
  | 'cancelado';

/** Linha de execução de um bloco, enriquecida com o nome do processo. */
export interface ExecBlocoRow {
  id: number;
  projetoId: number;
  execProcessoId: number;
  blocoId: string;
  processo: string;
  tipo: string;
  operador: string;
  titulo: string;
  saidas: any[];
  estado: EstadoExec;
  tentativa: number;
  erro: string | null;
  /** Id da extensão que serve o bloco (só para operador ia/codigo); null nos restantes. */
  extensaoId: string | null;
}

/** Linha de uma extensão instalada (sem capacidades; ver obterCapacidades). */
export interface ExtensaoInfo {
  id: string;
  nome: string;
  versao: string;
  autor: string;
  licenca: string;
  caminho: string;
  ativa: boolean;
  notaConsentimento: string | null;
  instaladaEm: string;
}

/**
 * Job pendente pronto a ser executado por uma extensão: junta o job, o
 * bloco que o originou e o processo.
 *
 * Campos do JOIN (especificação M2 do protocolo): `jobId`,
 * `execBlocoId`, `projetoId`, `blocoId`, `tipo`, `operador`, `processo`,
 * `titulo`, `extensaoId`, `saidas`, `tentativa` (do bloco) e
 * `tentativasJob` (passagens do próprio job, para o backoff).
 *
 * Colunas do job em bruto (compatibilidade com o contrato combinado
 * com o executor e a API): `id` (= `jobId`), `estado`, `detalhe`,
 * `criadaEm`, `tentativas` (= `tentativasJob`) e `proximaExecucao`.
 */
export interface JobPendente {
  jobId: number;
  execBlocoId: number;
  projetoId: number;
  blocoId: string;
  tipo: string;
  operador: 'ia' | 'codigo';
  processo: string;
  titulo: string;
  extensaoId: string | null;
  saidas: Porta[];
  tentativa: number;
  tentativasJob: number;
  /** Mesmo que `jobId` (nome usado pelo executor). */
  id: number;
  estado: 'pendente' | 'em_curso' | 'concluido' | 'falhou';
  detalhe: string | null;
  criadaEm: string;
  /** Mesmo que `tentativasJob` (nome usado pelo executor). */
  tentativas: number;
  proximaExecucao: string | null;
}

/** Uma entrega produzida por um bloco (facto imutável). */
export interface EntregaRow {
  id: number;
  execBlocoId: number;
  projetoId: number;
  tentativa: number;
  tipo: unknown;
  valor: unknown;
  criadaEm: string;
}

/**
 * Definição de um bloco lida do snapshot imutável do projeto (M3).
 *
 * É a mesma definição que originou o bloco de execução: portas de entrada
 * declaradas no método e parâmetros do bloco. Lê-se do snapshot — nunca do
 * método vigente — para não depender de edições posteriores ao arranque.
 */
export interface DefinicaoBloco {
  /** Portas de entrada declaradas no método (podem receber valores encadeados). */
  entradas: Porta[];
  /** Parâmetros do bloco definidos no método (ausente se não declarados). */
  parametros?: Record<string, unknown>;
}

/** Visão completa de um projeto: dados, processos e respetivos blocos. */
export interface ProjetoDetalhado {
  projeto: { id: number; canalId: number; nome: string; estado: string };
  processos: {
    id: number;
    processo: string;
    ordem: number;
    estado: EstadoExec;
    blocos: ExecBlocoRow[];
  }[];
}

export interface Banco {
  fechar(): void;
  criarCanal(nome: string, ordemProcessos: string[]): { id: number; nome: string; ordemProcessos: string[] };
  listarCanais(): { id: number; nome: string }[];
  obterCanal(id: number): { id: number; nome: string; ordemProcessos: string[] } | undefined;
  guardarMetodo(canalId: number, metodo: { processo: string; blocos: unknown[] }): number;
  obterMetodoVigente(
    canalId: number,
    processo: string,
  ): { versao: number; definicao: { processo: string; blocos: any[] } } | undefined;
  criarProjeto(canalId: number, nome: string): ProjetoDetalhado;
  obterProjeto(id: number): ProjetoDetalhado | undefined;
  listarProjetos(): { id: number; canalId: number; nome: string; estado: string }[];
  marcarProjeto(id: number, estado: 'concluido' | 'cancelado'): void;
  obterExecBloco(id: number): ExecBlocoRow | undefined;
  obterExecBlocoPorBlocoId(projetoId: number, blocoId: string): ExecBlocoRow | undefined;
  /** Lê `entradas`/`parametros` do bloco no snapshot imutável do projeto (M3). */
  obterDefinicaoBloco(
    projetoId: number,
    processo: string,
    blocoId: string,
  ): DefinicaoBloco | undefined;
  definirEstadoBloco(id: number, estado: EstadoExec, erro?: string | null): void;
  incrementarTentativa(id: number): number;
  registarTentativa(execBlocoId: number, numero: number, antes: string, depois: string, detalhe?: string): void;
  registarEntrega(
    execBlocoId: number,
    projetoId: number,
    tentativa: number,
    tipo: unknown,
    valor: unknown,
  ): { id: number };
  listarEntregas(projetoId: number): EntregaRow[];
  registarAprovacao(
    execBlocoId: number,
    decisao: 'aprovado' | 'rejeitado',
    autor?: string,
    comentario?: string,
  ): void;
  criarJob(execBlocoId: number, operador: 'ia' | 'codigo'): { id: number };
  atualizarJob(id: number, estado: 'pendente' | 'em_curso' | 'concluido' | 'falhou', detalhe?: string): void;
  proximoBlocoPendente(projetoId: number): ExecBlocoRow | undefined;
  /* Extensões (M2) */
  instalarExtensao(reg: {
    id: string;
    nome: string;
    versao: string;
    autor: string;
    licenca: string;
    caminho: string;
  }): void;
  listarExtensoes(): { id: string; nome: string; versao: string; ativa: boolean }[];
  obterExtensao(id: string): ExtensaoInfo | undefined;
  definirExtensaoAtiva(id: string, ativa: boolean, nota?: string): void;
  removerExtensao(id: string): void;
  guardarCapacidades(extensaoId: string, capacidades: { id: string; definicao: unknown }[]): void;
  obterCapacidades(extensaoId: string): { id: string; definicao: unknown }[];
  listarJobsPendentes(): JobPendente[];
  incrementarTentativaJob(id: number): number;
  definirProximaExecucaoJob(id: number, iso: string | null): void;
}

/* ------------------------------------------------------------------ */
/* Tipos internos das linhas brutas devolvidas pelo better-sqlite3    */
/* ------------------------------------------------------------------ */

interface CanalBruto {
  id: number;
  nome: string;
  ordem_processos: string;
  criado_em: string;
}

interface MetodoBruto {
  id: number;
  canal_id: number;
  processo: string;
  versao: number;
  definicao: string;
  criado_em: string;
}

interface ProjetoBruto {
  id: number;
  canal_id: number;
  nome: string;
  estado: string;
  snapshot: string;
  criado_em: string;
}

interface ExecProcessoBruto {
  id: number;
  projeto_id: number;
  processo: string;
  ordem: number;
  estado: string;
}

interface ExecBlocoBruto {
  id: number;
  projeto_id: number;
  exec_processo_id: number;
  bloco_id: string;
  tipo: string;
  operador: string;
  titulo: string;
  saidas: string;
  estado: string;
  tentativa: number;
  erro: string | null;
  extensao_id: string | null;
  processo: string;
}

interface ExtensaoBruta {
  id: string;
  nome: string;
  versao: string;
  autor: string;
  licenca: string;
  caminho: string;
  ativa: number;
  nota_consentimento: string | null;
  instalada_em: string;
}

interface CapacidadeBruta {
  capacidade_id: string;
  definicao: string;
}

interface JobPendenteBruto {
  job_id: number;
  exec_bloco_id: number;
  projeto_id: number;
  bloco_id: string;
  tipo: string;
  operador: string;
  estado: string;
  detalhe: string | null;
  criada_em: string;
  extensao_id: string | null;
  processo: string;
  titulo: string;
  saidas: string;
  tentativa: number;
  tentativas_job: number;
  proxima_execucao: string | null;
}

interface EntregaBruta {
  id: number;
  exec_bloco_id: number;
  projeto_id: number;
  tentativa: number;
  tipo: string;
  valor: string;
  criada_em: string;
}

/** Forma esperada de um bloco dentro da definição de um método. */
interface BlocoBruto {
  id?: unknown;
  tipo?: unknown;
  operador?: unknown;
  titulo?: unknown;
  saidas?: unknown;
  extensaoId?: unknown;
}

const TIPOS_BLOCO = ['PESQUISAR', 'ESCOLHER', 'CRIAR', 'VALIDAR'] as const;
const OPERADORES = ['humano', 'ia', 'codigo'] as const;
const ESTADOS_EXEC: EstadoExec[] = [
  'pendente',
  'em_curso',
  'aguardar_aprovacao',
  'concluido',
  'falhou',
  'cancelado',
];
const ESTADOS_JOB = ['pendente', 'em_curso', 'concluido', 'falhou'] as const;

/* ------------------------------------------------------------------ */
/* Utilitários                                                        */
/* ------------------------------------------------------------------ */

function agoraIso(): string {
  return new Date().toISOString();
}

function parseJson<T>(texto: string, contexto: string): T {
  try {
    return JSON.parse(texto) as T;
  } catch {
    throw new Error(`JSON inválido em ${contexto}.`);
  }
}

function validarEstadoExec(estado: string): EstadoExec {
  if (!(ESTADOS_EXEC as string[]).includes(estado)) {
    throw new Error(`Estado de execução inválido: '${estado}'.`);
  }
  return estado as EstadoExec;
}

function validarOrdemProcessos(ordem: string[]): string[] {
  if (!Array.isArray(ordem) || ordem.length === 0) {
    throw new Error('A ordem de processos tem de ser um array não vazio de nomes.');
  }
  const vistos = new Set<string>();
  for (const nome of ordem) {
    if (typeof nome !== 'string' || nome.trim() === '') {
      throw new Error('Cada processo da ordem tem de ser um nome não vazio.');
    }
    if (vistos.has(nome)) {
      throw new Error(`Processo duplicado na ordem do canal: '${nome}'.`);
    }
    vistos.add(nome);
  }
  if (ordem.length !== 8) {
    throw new Error(`A ordem do canal tem de conter exatamente 8 processos (recebidos: ${ordem.length}).`);
  }
  return [...ordem];
}

/** Normaliza um bloco bruto da definição do método para colunas da tabela. */
function normalizarBloco(bloco: unknown, processo: string, indice: number): {
  blocoId: string;
  tipo: string;
  operador: string;
  titulo: string;
  saidas: unknown[];
  extensaoId: string | undefined;
} {
  if (typeof bloco !== 'object' || bloco === null) {
    throw new Error(`Bloco ${indice} do processo '${processo}' não é um objeto.`);
  }
  const b = bloco as BlocoBruto;
  const tipo = typeof b.tipo === 'string' ? b.tipo : '';
  if (!(TIPOS_BLOCO as readonly string[]).includes(tipo)) {
    throw new Error(
      `Bloco ${indice} do processo '${processo}': tipo inválido '${tipo}'. Esperado um de: ${TIPOS_BLOCO.join(', ')}.`,
    );
  }
  const operador = typeof b.operador === 'string' ? b.operador : '';
  if (!(OPERADORES as readonly string[]).includes(operador)) {
    throw new Error(
      `Bloco ${indice} do processo '${processo}': operador inválido '${operador}'. Esperado um de: ${OPERADORES.join(', ')}.`,
    );
  }
  const blocoId =
    typeof b.id === 'string' && b.id.trim() !== '' ? b.id : `${processo}-bloco-${indice + 1}`;
  const titulo = typeof b.titulo === 'string' && b.titulo.trim() !== '' ? b.titulo : `${tipo} ${indice + 1}`;
  const saidas = Array.isArray(b.saidas) ? (b.saidas as unknown[]) : [];
  // A gramática exige extensaoId para blocos ia/codigo; aqui extrai-se de
  // forma tolerante (texto não vazio ou undefined) e guarda-se na coluna.
  const extensaoIdBruto = typeof b.extensaoId === 'string' ? b.extensaoId.trim() : '';
  const extensaoId = extensaoIdBruto !== '' ? extensaoIdBruto : undefined;
  return { blocoId, tipo, operador, titulo, saidas, extensaoId };
}

/** Mapeia uma linha bruta de execucoes_bloco para ExecBlocoRow. */
function mapearExecBloco(bruta: ExecBlocoBruto): ExecBlocoRow {
  return {
    id: bruta.id,
    projetoId: bruta.projeto_id,
    execProcessoId: bruta.exec_processo_id,
    blocoId: bruta.bloco_id,
    processo: bruta.processo,
    tipo: bruta.tipo,
    operador: bruta.operador,
    titulo: bruta.titulo,
    saidas: parseJson<any[]>(bruta.saidas, `saídas do bloco de execução ${bruta.id}`),
    estado: validarEstadoExec(bruta.estado),
    tentativa: bruta.tentativa,
    erro: bruta.erro,
    extensaoId: bruta.extensao_id ?? null,
  };
}

/** Id efetivo de um bloco bruto da definição (mesma regra de `normalizarBloco`). */
function idBlocoBruto(bloco: unknown, processo: string, indice: number): string | undefined {
  if (typeof bloco !== 'object' || bloco === null) return undefined;
  const id = (bloco as { id?: unknown }).id;
  return typeof id === 'string' && id.trim() !== '' ? id : `${processo}-bloco-${indice + 1}`;
}

/**
 * Portas de entrada declaradas num bloco bruto. Leitura defensiva: só conta
 * o que parece uma porta (`chave` não vazia); o resto é ignorado para não
 * partir a execução por definições antigas ou malformadas.
 */
function extrairPortasEntrada(bloco: object): Porta[] {
  const brutas = (bloco as { entradas?: unknown }).entradas;
  if (!Array.isArray(brutas)) return [];
  const portas: Porta[] = [];
  for (const bruta of brutas) {
    if (
      typeof bruta === 'object' &&
      bruta !== null &&
      typeof (bruta as { chave?: unknown }).chave === 'string' &&
      (bruta as { chave: string }).chave.trim() !== ''
    ) {
      portas.push(bruta as Porta);
    }
  }
  return portas;
}

/** Parâmetros declarados num bloco bruto (cópia; undefined se ausentes). */
function extrairParametros(bloco: object): Record<string, unknown> | undefined {
  const brutos = (bloco as { parametros?: unknown }).parametros;
  if (typeof brutos !== 'object' || brutos === null || Array.isArray(brutos)) return undefined;
  return { ...(brutos as Record<string, unknown>) };
}

/* ------------------------------------------------------------------ */
/* Fábrica da base de dados                                           */
/* ------------------------------------------------------------------ */

/**
 * Abre (ou cria) a base de dados SQLite e aplica o DDL.
 * Por omissão usa ':memory:' — útil para testes e para arranque efémero.
 */
export function abrirBanco(caminho = ':memory:'): Banco {
  const db = new Database(caminho);
  db.pragma('foreign_keys = ON');
  db.exec(DDL);

  // ── Migrações M2 (protocolo de extensões) ─────────────────────────
  // Idempotentes: cada ALTER só corre se a coluna ainda não existir, por
  // isso bases de dados criadas pelo M1 são atualizadas sem perda de dados.
  const colunasDaTabela = (tabela: string): Set<string> => {
    // Nomes de tabelas internos (nunca input do utilizador).
    const linhas = db.prepare(`PRAGMA table_info(${tabela})`).all() as { name: string }[];
    return new Set(linhas.map((l) => l.name));
  };
  if (!colunasDaTabela('execucoes_bloco').has('extensao_id')) {
    db.exec('ALTER TABLE execucoes_bloco ADD COLUMN extensao_id TEXT');
  }
  const colunasJobs = colunasDaTabela('jobs');
  if (!colunasJobs.has('tentativas')) {
    db.exec('ALTER TABLE jobs ADD COLUMN tentativas INTEGER NOT NULL DEFAULT 0');
  }
  if (!colunasJobs.has('proxima_execucao')) {
    db.exec('ALTER TABLE jobs ADD COLUMN proxima_execucao TEXT');
  }

  const obterCanal = (id: number): { id: number; nome: string; ordemProcessos: string[] } | undefined => {
    const linha = db.prepare('SELECT * FROM canais WHERE id = ?').get(id) as CanalBruto | undefined;
    if (!linha) return undefined;
    return {
      id: linha.id,
      nome: linha.nome,
      ordemProcessos: parseJson<string[]>(linha.ordem_processos, `ordem de processos do canal ${id}`),
    };
  };

  const obterMetodoVigente = (
    canalId: number,
    processo: string,
  ): { versao: number; definicao: { processo: string; blocos: any[] } } | undefined => {
    const linha = db
      .prepare('SELECT * FROM metodos WHERE canal_id = ? AND processo = ? ORDER BY versao DESC LIMIT 1')
      .get(canalId, processo) as MetodoBruto | undefined;
    if (!linha) return undefined;
    return {
      versao: linha.versao,
      definicao: parseJson<{ processo: string; blocos: any[] }>(
        linha.definicao,
        `definição do método ${canalId}/${processo} v${linha.versao}`,
      ),
    };
  };

  // Lê `entradas`/`parametros` de um bloco a partir do snapshot imutável do
  // projeto (a mesma fonte de onde os blocos de execução foram criados).
  // Devolve undefined quando o projeto, o processo ou o bloco não existem —
  // o executor trata isso como "sem parâmetros nem entradas".
  const obterDefinicaoBloco = (
    projetoId: number,
    processo: string,
    blocoId: string,
  ): DefinicaoBloco | undefined => {
    const linha = db.prepare('SELECT snapshot FROM projetos WHERE id = ?').get(projetoId) as
      | { snapshot: string }
      | undefined;
    if (!linha) return undefined;
    let snapshot: unknown;
    try {
      snapshot = JSON.parse(linha.snapshot);
    } catch {
      return undefined;
    }
    if (typeof snapshot !== 'object' || snapshot === null) return undefined;
    const metodos = (snapshot as { metodos?: unknown }).metodos;
    if (typeof metodos !== 'object' || metodos === null) return undefined;
    const metodo = (metodos as Record<string, unknown>)[processo];
    if (typeof metodo !== 'object' || metodo === null) return undefined;
    const blocos = (metodo as { blocos?: unknown }).blocos;
    if (!Array.isArray(blocos)) return undefined;
    const bruto = blocos.find((b, indice) => idBlocoBruto(b, processo, indice) === blocoId);
    if (typeof bruto !== 'object' || bruto === null) return undefined;
    const parametros = extrairParametros(bruto);
    return {
      entradas: extrairPortasEntrada(bruto),
      ...(parametros === undefined ? {} : { parametros }),
    };
  };

  const montarProjeto = (projetoId: number): ProjetoDetalhado | undefined => {
    const linha = db.prepare('SELECT * FROM projetos WHERE id = ?').get(projetoId) as ProjetoBruto | undefined;
    if (!linha) return undefined;
    const processosBrutos = db
      .prepare('SELECT * FROM execucoes_processo WHERE projeto_id = ? ORDER BY ordem ASC')
      .all(projetoId) as ExecProcessoBruto[];
    const processos = processosBrutos.map((p) => {
      const blocosBrutos = db
        .prepare(
          `SELECT eb.*, ep.processo AS processo
           FROM execucoes_bloco eb
           JOIN execucoes_processo ep ON ep.id = eb.exec_processo_id
           WHERE eb.exec_processo_id = ?
           ORDER BY eb.id ASC`,
        )
        .all(p.id) as ExecBlocoBruto[];
      return {
        id: p.id,
        processo: p.processo,
        ordem: p.ordem,
        estado: validarEstadoExec(p.estado),
        blocos: blocosBrutos.map(mapearExecBloco),
      };
    });
    return {
      projeto: { id: linha.id, canalId: linha.canal_id, nome: linha.nome, estado: linha.estado },
      processos,
    };
  };

  const criarProjetoTx = db.transaction((canalId: number, nome: string): number => {
    const canal = obterCanal(canalId);
    if (!canal) {
      throw new Error(`O canal ${canalId} não existe.`);
    }
    if (typeof nome !== 'string' || nome.trim() === '') {
      throw new Error('O nome do projeto não pode estar vazio.');
    }
    // Valida que existe método vigente para cada processo da ordem do canal.
    const metodos: Record<string, { versao: number; blocos: any[] }> = {};
    for (const processo of canal.ordemProcessos) {
      const vigente = obterMetodoVigente(canalId, processo);
      if (!vigente) {
        throw new Error(
          `Falta método vigente para o processo '${processo}': não é possível criar o projeto.`,
        );
      }
      metodos[processo] = { versao: vigente.versao, blocos: vigente.definicao.blocos };
    }
    // Snapshot imutável: congela ordem + versões dos métodos no arranque.
    const snapshot = JSON.stringify({ ordemProcessos: canal.ordemProcessos, metodos });
    const projetoId = (
      db
        .prepare("INSERT INTO projetos (canal_id, nome, estado, snapshot, criado_em) VALUES (?, ?, 'ativo', ?, ?)")
        .run(canalId, nome, snapshot, agoraIso()) as { lastInsertRowid: number | bigint }
    ).lastInsertRowid as number;

    canal.ordemProcessos.forEach((processo, ordem) => {
      const execProcessoId = (
        db
          .prepare(
            "INSERT INTO execucoes_processo (projeto_id, processo, ordem, estado) VALUES (?, ?, ?, 'pendente')",
          )
          .run(projetoId, processo, ordem) as { lastInsertRowid: number | bigint }
      ).lastInsertRowid as number;
      metodos[processo].blocos.forEach((bloco, indice) => {
        const n = normalizarBloco(bloco, processo, indice);
        db.prepare(
          `INSERT INTO execucoes_bloco
             (projeto_id, exec_processo_id, bloco_id, tipo, operador, titulo, saidas, extensao_id, estado, tentativa)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendente', 1)`,
        ).run(
          projetoId,
          execProcessoId,
          n.blocoId,
          n.tipo,
          n.operador,
          n.titulo,
          JSON.stringify(n.saidas),
          n.extensaoId ?? null,
        );
      });
    });
    return projetoId;
  });

  const banco: Banco = {
    fechar(): void {
      db.close();
    },

    criarCanal(nome: string, ordemProcessos: string[]) {
      if (typeof nome !== 'string' || nome.trim() === '') {
        throw new Error('O nome do canal não pode estar vazio.');
      }
      const ordem = validarOrdemProcessos(ordemProcessos);
      const id = (
        db
          .prepare('INSERT INTO canais (nome, ordem_processos, criado_em) VALUES (?, ?, ?)')
          .run(nome, JSON.stringify(ordem), agoraIso()) as { lastInsertRowid: number | bigint }
      ).lastInsertRowid as number;
      return { id, nome, ordemProcessos: ordem };
    },

    listarCanais() {
      const linhas = db.prepare('SELECT id, nome FROM canais ORDER BY id ASC').all() as {
        id: number;
        nome: string;
      }[];
      return linhas.map((l) => ({ id: l.id, nome: l.nome }));
    },

    obterCanal,

    guardarMetodo(canalId: number, metodo: { processo: string; blocos: unknown[] }): number {
      const canal = obterCanal(canalId);
      if (!canal) {
        throw new Error(`O canal ${canalId} não existe.`);
      }
      if (!canal.ordemProcessos.includes(metodo.processo)) {
        throw new Error(
          `O processo '${metodo.processo}' não consta da ordem do canal '${canal.nome}'.`,
        );
      }
      if (!Array.isArray(metodo.blocos) || metodo.blocos.length === 0) {
        throw new Error(`O método do processo '${metodo.processo}' tem de ter pelo menos um bloco.`);
      }
      // Valida cada bloco antes de gravar, para não registar versões inválidas.
      metodo.blocos.forEach((bloco, indice) => normalizarBloco(bloco, metodo.processo, indice));
      const atual = db
        .prepare('SELECT MAX(versao) AS max_versao FROM metodos WHERE canal_id = ? AND processo = ?')
        .get(canalId, metodo.processo) as { max_versao: number | null };
      const novaVersao = (atual.max_versao ?? 0) + 1;
      const definicao = JSON.stringify({ processo: metodo.processo, blocos: metodo.blocos });
      db.prepare(
        'INSERT INTO metodos (canal_id, processo, versao, definicao, criado_em) VALUES (?, ?, ?, ?, ?)',
      ).run(canalId, metodo.processo, novaVersao, definicao, agoraIso());
      return novaVersao;
    },

    obterMetodoVigente,

    criarProjeto(canalId: number, nome: string): ProjetoDetalhado {
      const projetoId = criarProjetoTx(canalId, nome);
      const detalhado = montarProjeto(projetoId);
      if (!detalhado) {
        throw new Error(`Falha interna: projeto ${projetoId} acabado de criar não foi encontrado.`);
      }
      return detalhado;
    },

    obterProjeto(id: number): ProjetoDetalhado | undefined {
      return montarProjeto(id);
    },

    listarProjetos() {
      const linhas = db
        .prepare('SELECT id, canal_id, nome, estado FROM projetos ORDER BY id ASC')
        .all() as { id: number; canal_id: number; nome: string; estado: string }[];
      return linhas.map((l) => ({ id: l.id, canalId: l.canal_id, nome: l.nome, estado: l.estado }));
    },

    marcarProjeto(id: number, estado: 'concluido' | 'cancelado'): void {
      if (estado !== 'concluido' && estado !== 'cancelado') {
        throw new Error(`Estado de projeto inválido: '${estado}'.`);
      }
      const resultado = db.prepare('UPDATE projetos SET estado = ? WHERE id = ?').run(estado, id);
      if (resultado.changes === 0) {
        throw new Error(`O projeto ${id} não existe.`);
      }
    },

    obterExecBloco(id: number): ExecBlocoRow | undefined {
      const linha = db
        .prepare(
          `SELECT eb.*, ep.processo AS processo
           FROM execucoes_bloco eb
           JOIN execucoes_processo ep ON ep.id = eb.exec_processo_id
           WHERE eb.id = ?`,
        )
        .get(id) as ExecBlocoBruto | undefined;
      return linha ? mapearExecBloco(linha) : undefined;
    },

    obterExecBlocoPorBlocoId(projetoId: number, blocoId: string): ExecBlocoRow | undefined {
      const linha = db
        .prepare(
          `SELECT eb.*, ep.processo AS processo
           FROM execucoes_bloco eb
           JOIN execucoes_processo ep ON ep.id = eb.exec_processo_id
           WHERE eb.projeto_id = ? AND eb.bloco_id = ?
           ORDER BY ep.ordem ASC, eb.id ASC
           LIMIT 1`,
        )
        .get(projetoId, blocoId) as ExecBlocoBruto | undefined;
      return linha ? mapearExecBloco(linha) : undefined;
    },

    obterDefinicaoBloco,

    definirEstadoBloco(id: number, estado: EstadoExec, erro?: string | null): void {
      const estadoValido = validarEstadoExec(estado);
      let resultado;
      if (erro === undefined) {
        resultado = db.prepare('UPDATE execucoes_bloco SET estado = ? WHERE id = ?').run(estadoValido, id);
      } else {
        resultado = db
          .prepare('UPDATE execucoes_bloco SET estado = ?, erro = ? WHERE id = ?')
          .run(estadoValido, erro, id);
      }
      if (resultado.changes === 0) {
        throw new Error(`O bloco de execução ${id} não existe.`);
      }
    },

    incrementarTentativa(id: number): number {
      const resultado = db
        .prepare('UPDATE execucoes_bloco SET tentativa = tentativa + 1 WHERE id = ?')
        .run(id);
      if (resultado.changes === 0) {
        throw new Error(`O bloco de execução ${id} não existe.`);
      }
      const linha = db.prepare('SELECT tentativa FROM execucoes_bloco WHERE id = ?').get(id) as {
        tentativa: number;
      };
      return linha.tentativa;
    },

    registarTentativa(
      execBlocoId: number,
      numero: number,
      antes: string,
      depois: string,
      detalhe?: string,
    ): void {
      validarEstadoExec(antes);
      validarEstadoExec(depois);
      db.prepare(
        `INSERT INTO tentativas (exec_bloco_id, numero, estado_antes, estado_depois, detalhe, criada_em)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(execBlocoId, numero, antes, depois, detalhe ?? null, agoraIso());
    },

    registarEntrega(
      execBlocoId: number,
      projetoId: number,
      tentativa: number,
      tipo: unknown,
      valor: unknown,
    ): { id: number } {
      const id = (
        db
          .prepare(
            `INSERT INTO entregas (exec_bloco_id, projeto_id, tentativa, tipo, valor, criada_em)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(execBlocoId, projetoId, tentativa, JSON.stringify(tipo), JSON.stringify(valor), agoraIso()) as {
          lastInsertRowid: number | bigint;
        }
      ).lastInsertRowid as number;
      return { id };
    },

    listarEntregas(projetoId: number): EntregaRow[] {
      const linhas = db
        .prepare('SELECT * FROM entregas WHERE projeto_id = ? ORDER BY id ASC')
        .all(projetoId) as EntregaBruta[];
      return linhas.map((l) => ({
        id: l.id,
        execBlocoId: l.exec_bloco_id,
        projetoId: l.projeto_id,
        tentativa: l.tentativa,
        tipo: parseJson<unknown>(l.tipo, `tipo da entrega ${l.id}`),
        valor: parseJson<unknown>(l.valor, `valor da entrega ${l.id}`),
        criadaEm: l.criada_em,
      }));
    },

    registarAprovacao(
      execBlocoId: number,
      decisao: 'aprovado' | 'rejeitado',
      autor?: string,
      comentario?: string,
    ): void {
      if (decisao !== 'aprovado' && decisao !== 'rejeitado') {
        throw new Error(`Decisão de aprovação inválida: '${decisao}'.`);
      }
      db.prepare(
        `INSERT INTO aprovacoes (exec_bloco_id, decisao, autor, comentario, criada_em)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(execBlocoId, decisao, autor ?? null, comentario ?? null, agoraIso());
    },

    criarJob(execBlocoId: number, operador: 'ia' | 'codigo'): { id: number } {
      if (operador !== 'ia' && operador !== 'codigo') {
        throw new Error(`Operador de job inválido: '${operador}'.`);
      }
      const id = (
        db
          .prepare("INSERT INTO jobs (exec_bloco_id, operador, estado, criada_em) VALUES (?, ?, 'pendente', ?)")
          .run(execBlocoId, operador, agoraIso()) as { lastInsertRowid: number | bigint }
      ).lastInsertRowid as number;
      return { id };
    },

    atualizarJob(
      id: number,
      estado: 'pendente' | 'em_curso' | 'concluido' | 'falhou',
      detalhe?: string,
    ): void {
      if (!(ESTADOS_JOB as readonly string[]).includes(estado)) {
        throw new Error(`Estado de job inválido: '${estado}'.`);
      }
      let resultado;
      if (detalhe === undefined) {
        resultado = db.prepare('UPDATE jobs SET estado = ? WHERE id = ?').run(estado, id);
      } else {
        resultado = db.prepare('UPDATE jobs SET estado = ?, detalhe = ? WHERE id = ?').run(estado, detalhe, id);
      }
      if (resultado.changes === 0) {
        throw new Error(`O job ${id} não existe.`);
      }
    },

    proximoBlocoPendente(projetoId: number): ExecBlocoRow | undefined {
      const linha = db
        .prepare(
          `SELECT eb.*, ep.processo AS processo
           FROM execucoes_bloco eb
           JOIN execucoes_processo ep ON ep.id = eb.exec_processo_id
           WHERE eb.projeto_id = ? AND eb.estado = 'pendente'
           ORDER BY ep.ordem ASC, eb.id ASC
           LIMIT 1`,
        )
        .get(projetoId) as ExecBlocoBruto | undefined;
      return linha ? mapearExecBloco(linha) : undefined;
    },

    /* ── Extensões (M2) ─────────────────────────────────────────── */

    instalarExtensao(reg: {
      id: string;
      nome: string;
      versao: string;
      autor: string;
      licenca: string;
      caminho: string;
    }): void {
      for (const [campo, valor] of Object.entries(reg)) {
        if (typeof valor !== 'string' || valor.trim() === '') {
          throw new Error(`O campo '${campo}' da extensão não pode estar vazio.`);
        }
      }
      const existente = db.prepare('SELECT id FROM extensoes WHERE id = ?').get(reg.id);
      if (existente) {
        throw new Error(`A extensão '${reg.id}' já está instalada.`);
      }
      db.prepare(
        `INSERT INTO extensoes
           (id, nome, versao, autor, licenca, caminho, ativa, instalada_em)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      ).run(reg.id, reg.nome, reg.versao, reg.autor, reg.licenca, reg.caminho, agoraIso());
    },

    listarExtensoes() {
      const linhas = db
        .prepare('SELECT id, nome, versao, ativa FROM extensoes ORDER BY id ASC')
        .all() as { id: string; nome: string; versao: string; ativa: number }[];
      return linhas.map((l) => ({ id: l.id, nome: l.nome, versao: l.versao, ativa: l.ativa === 1 }));
    },

    obterExtensao(id: string): ExtensaoInfo | undefined {
      const linha = db.prepare('SELECT * FROM extensoes WHERE id = ?').get(id) as
        | ExtensaoBruta
        | undefined;
      if (!linha) return undefined;
      return {
        id: linha.id,
        nome: linha.nome,
        versao: linha.versao,
        autor: linha.autor,
        licenca: linha.licenca,
        caminho: linha.caminho,
        ativa: linha.ativa === 1,
        notaConsentimento: linha.nota_consentimento,
        instaladaEm: linha.instalada_em,
      };
    },

    definirExtensaoAtiva(id: string, ativa: boolean, nota?: string): void {
      // Sem nota nova, mantém-se a nota anterior (COALESCE).
      const resultado = db
        .prepare(
          'UPDATE extensoes SET ativa = ?, nota_consentimento = COALESCE(?, nota_consentimento) WHERE id = ?',
        )
        .run(ativa ? 1 : 0, nota ?? null, id);
      if (resultado.changes === 0) {
        throw new Error(`A extensão '${id}' não está instalada.`);
      }
    },

    removerExtensao(id: string): void {
      db.prepare('DELETE FROM capacidades WHERE extensao_id = ?').run(id);
      const resultado = db.prepare('DELETE FROM extensoes WHERE id = ?').run(id);
      if (resultado.changes === 0) {
        throw new Error(`A extensão '${id}' não está instalada.`);
      }
    },

    guardarCapacidades(
      extensaoId: string,
      capacidades: { id: string; definicao: unknown }[],
    ): void {
      const existente = db.prepare('SELECT id FROM extensoes WHERE id = ?').get(extensaoId);
      if (!existente) {
        throw new Error(`A extensão '${extensaoId}' não está instalada.`);
      }
      const inserir = db.prepare(
        'INSERT INTO capacidades (extensao_id, capacidade_id, definicao) VALUES (?, ?, ?)',
      );
      const guardarTx = db.transaction((caps: { id: string; definicao: unknown }[]) => {
        db.prepare('DELETE FROM capacidades WHERE extensao_id = ?').run(extensaoId);
        for (const c of caps) {
          if (typeof c.id !== 'string' || c.id.trim() === '') {
            throw new Error('Cada capacidade guardada tem de ter um id não vazio.');
          }
          inserir.run(extensaoId, c.id, JSON.stringify(c.definicao));
        }
      });
      guardarTx(capacidades);
    },

    obterCapacidades(extensaoId: string): { id: string; definicao: unknown }[] {
      const linhas = db
        .prepare(
          'SELECT capacidade_id, definicao FROM capacidades WHERE extensao_id = ? ORDER BY capacidade_id ASC',
        )
        .all(extensaoId) as CapacidadeBruta[];
      return linhas.map((l) => ({
        id: l.capacidade_id,
        definicao: parseJson<unknown>(l.definicao, `definição da capacidade '${extensaoId}/${l.capacidade_id}'`),
      }));
    },

    listarJobsPendentes(): JobPendente[] {
      const linhas = db
        .prepare(
          `SELECT j.id AS job_id, eb.id AS exec_bloco_id, eb.projeto_id, eb.bloco_id,
                  eb.tipo, j.operador, j.estado, j.detalhe, j.criada_em,
                  eb.extensao_id, ep.processo AS processo,
                  eb.titulo, eb.saidas, eb.tentativa, j.tentativas AS tentativas_job,
                  j.proxima_execucao
           FROM jobs j
           JOIN execucoes_bloco eb ON eb.id = j.exec_bloco_id
           JOIN execucoes_processo ep ON ep.id = eb.exec_processo_id
           WHERE j.estado = 'pendente'
           ORDER BY j.id ASC`,
        )
        .all() as JobPendenteBruto[];
      return linhas.map((l) => {
        if (l.operador !== 'ia' && l.operador !== 'codigo') {
          throw new Error(`O job ${l.job_id} tem um operador inválido na base de dados: '${l.operador}'.`);
        }
        const estadosJob = ['pendente', 'em_curso', 'concluido', 'falhou'] as const;
        if (!(estadosJob as readonly string[]).includes(l.estado)) {
          throw new Error(`O job ${l.job_id} tem um estado inválido na base de dados: '${l.estado}'.`);
        }
        return {
          jobId: l.job_id,
          execBlocoId: l.exec_bloco_id,
          projetoId: l.projeto_id,
          blocoId: l.bloco_id,
          tipo: l.tipo,
          operador: l.operador,
          processo: l.processo,
          titulo: l.titulo,
          extensaoId: l.extensao_id,
          saidas: parseJson<Porta[]>(l.saidas, `saídas do bloco de execução ${l.exec_bloco_id}`),
          tentativa: l.tentativa,
          tentativasJob: l.tentativas_job,
          id: l.job_id,
          estado: l.estado as 'pendente' | 'em_curso' | 'concluido' | 'falhou',
          detalhe: l.detalhe,
          criadaEm: l.criada_em,
          tentativas: l.tentativas_job,
          proximaExecucao: l.proxima_execucao,
        };
      });
    },

    incrementarTentativaJob(id: number): number {
      const resultado = db.prepare('UPDATE jobs SET tentativas = tentativas + 1 WHERE id = ?').run(id);
      if (resultado.changes === 0) {
        throw new Error(`O job ${id} não existe.`);
      }
      const linha = db.prepare('SELECT tentativas FROM jobs WHERE id = ?').get(id) as {
        tentativas: number;
      };
      return linha.tentativas;
    },

    definirProximaExecucaoJob(id: number, iso: string | null): void {
      const resultado = db
        .prepare('UPDATE jobs SET proxima_execucao = ? WHERE id = ?')
        .run(iso, id);
      if (resultado.changes === 0) {
        throw new Error(`O job ${id} não existe.`);
      }
    },
  };

  return banco;
}

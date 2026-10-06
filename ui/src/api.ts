// Licensed under the Business Source License 1.1 — see LICENSE-DRAFT.md

/**
 * Cliente da API local do Wild Studio (`http://localhost:3000`).
 *
 * Em desenvolvimento os pedidos vão para `/api` (o Vite encaminha para a
 * API); na versão compilada, a UI é servida pela mesma origem, por isso os
 * caminhos relativos continuam a funcionar.
 *
 * Erros: a API devolve `{ erro: string }` (mensagens em pt-PT); aqui são
 * convertidos em `Error` com essa mensagem.
 */

/* ------------------------------ Tipos ------------------------------ */

export type ProcessoId =
  | 'tema'
  | 'titulo'
  | 'thumbnail'
  | 'guiao'
  | 'narracao'
  | 'visuais'
  | 'edicao'
  | 'publicacao';

export type BlocoTipo = 'PESQUISAR' | 'ESCOLHER' | 'CRIAR' | 'VALIDAR';
export type Operador = 'humano' | 'ia' | 'codigo';

export type EstadoExec =
  | 'pendente'
  | 'em_curso'
  | 'aguardar_aprovacao'
  | 'concluido'
  | 'falhou'
  | 'cancelado';

export interface ContentShape {
  tipo: 'conteudo';
  familia: 'texto' | 'imagem' | 'audio' | 'video';
  cardinalidade: 'um' | 'varios';
  representacao: 'embutido' | 'artefacto' | 'ambos';
  formatos?: { mimeTypes?: string[]; extensoes?: string[] };
}

export interface ControlShape {
  tipo: 'controlo';
  controlo: 'identificador' | 'numero' | 'booleano' | 'selecao' | 'datahora' | 'url' | 'aprovacao';
  cardinalidade: 'um' | 'varios';
  opcoes?: string[];
}

export interface CampoRegisto {
  id: string;
  rotulo: string;
  chave: string;
  tipo: ValueShape;
  obrigatorio: boolean;
}

export interface RecordShape {
  tipo: 'registo';
  cardinalidade: 'um' | 'varios';
  campos: CampoRegisto[];
}

export type ValueShape = ContentShape | ControlShape | RecordShape;

export interface Porta {
  chave: string;
  rotulo?: string;
  tipo: ValueShape;
  obrigatoria: boolean;
}

export interface BlocoDef {
  id: string;
  tipo: BlocoTipo;
  operador: Operador;
  titulo: string;
  descricao?: string;
  entradas: Porta[];
  saidas: Porta[];
  parametros?: Record<string, unknown>;
  extensaoId?: string;
}

export interface MetodoDef {
  processo: ProcessoId;
  versao?: number;
  blocos: BlocoDef[];
}

export interface Canal {
  id: number;
  nome: string;
}

export interface CanalDetalhado {
  id: number;
  nome: string;
  ordemProcessos: ProcessoId[];
  metodos: Record<ProcessoId, { versao: number; definicao: MetodoDef } | null>;
}

export interface ExecBloco {
  id: number;
  projetoId: number;
  execProcessoId: number;
  blocoId: string;
  processo: ProcessoId;
  tipo: BlocoTipo;
  operador: Operador;
  titulo: string;
  saidas: Porta[];
  estado: EstadoExec;
  tentativa: number;
  erro: string | null;
  extensaoId: string | null;
}

export interface ExecProcesso {
  id: number;
  processo: ProcessoId;
  ordem: number;
  estado: EstadoExec;
  blocos: ExecBloco[];
}

export interface ProjetoDetalhado {
  projeto: { id: number; canalId: number; nome: string; estado: string };
  processos: ExecProcesso[];
}

export interface Projeto {
  id: number;
  nome: string;
  canalId: number;
}

export interface Entrega {
  id: number;
  execBlocoId: number;
  projetoId: number;
  tentativa: number;
  tipo: unknown;
  valor: unknown;
  criadaEm: string;
}

export interface ExtensaoResumo {
  id: string;
  nome: string;
  versao: string;
  ativa: boolean;
  capacidades: number;
}

export interface ExtensaoDetalhada {
  id: string;
  nome: string;
  versao: string;
  autor: string;
  licenca: string;
  ativa: boolean;
  caminho: string;
  instaladaEm: string;
  notaConsentimento: string | null;
  manifesto: unknown;
  capacidades: Array<{
    operador?: string;
    blocos?: string[];
    processos?: string[];
    efeitos?: string[];
    [chave: string]: unknown;
  }>;
}

export interface JobPendente {
  id: number;
  estado: string;
  operador: string;
  execBlocoId: number;
  bloco: {
    blocoId: string;
    titulo: string;
    tipo: string;
    processo: string;
    extensaoId: string | null;
    tentativa: number;
  };
  projetoId: number;
  projeto: string | null;
  tentativasJob: number;
}

export interface ResumoExecucaoJobs {
  executados: number;
  concluidos: number;
  falhados: number;
  adiados: number;
  detalhes: Array<{ jobId: number; resultado: string; detalhe?: string }>;
}

export interface ResultadoAvanco {
  acao: string;
  execBloco?: ExecBloco;
}

/* ------------------------- Chamadas HTTP -------------------------- */

async function pedido<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  const resposta = await fetch(caminho, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  let dados: unknown = null;
  try {
    dados = await resposta.json();
  } catch {
    dados = null;
  }
  if (!resposta.ok) {
    const mensagem =
      dados !== null && typeof dados === 'object' && 'erro' in dados && typeof (dados as { erro: unknown }).erro === 'string'
        ? (dados as { erro: string }).erro
        : `Pedido falhou (HTTP ${resposta.status}).`;
    throw new Error(mensagem);
  }
  return dados as T;
}

/* ------------------------------ Canais ---------------------------- */

export function listarCanais(): Promise<Canal[]> {
  return pedido<Canal[]>('GET', '/api/canais');
}

export function obterCanal(id: number): Promise<CanalDetalhado> {
  return pedido<CanalDetalhado>('GET', `/api/canais/${id}`);
}

export function criarCanal(nome: string, ordemProcessos: ProcessoId[]): Promise<{ id: number; nome: string }> {
  return pedido('POST', '/api/canais', { nome, ordemProcessos });
}

export function guardarMetodo(canalId: number, metodo: MetodoDef): Promise<{ processo: ProcessoId; versao: number }> {
  return pedido('PUT', `/api/canais/${canalId}/metodos`, metodo);
}

/* ----------------------------- Projetos --------------------------- */

export function listarProjetos(): Promise<Projeto[]> {
  return pedido<Projeto[]>('GET', '/api/projetos');
}

export function obterProjeto(id: number): Promise<ProjetoDetalhado> {
  return pedido<ProjetoDetalhado>('GET', `/api/projetos/${id}`);
}

export function criarProjeto(canalId: number, nome: string): Promise<{ id: number }> {
  return pedido('POST', '/api/projetos', { canalId, nome });
}

export function avancarProjeto(id: number): Promise<ResultadoAvanco> {
  return pedido<ResultadoAvanco>('POST', `/api/projetos/${id}/avancar`);
}

export function entregasProjeto(id: number): Promise<Entrega[]> {
  return pedido<Entrega[]>('GET', `/api/projetos/${id}/entregas`);
}

/* ------------------------ Blocos de execução ---------------------- */

export function submeterEntrega(
  execBlocoId: number,
  valor: unknown,
  autor?: string,
): Promise<unknown> {
  return pedido('POST', `/api/blocos/${execBlocoId}/entrega`, { valor, autor: autor || undefined });
}

export function aprovarBloco(
  execBlocoId: number,
  autor?: string,
  comentario?: string,
): Promise<unknown> {
  return pedido('POST', `/api/blocos/${execBlocoId}/aprovar`, {
    autor: autor || undefined,
    comentario: comentario || undefined,
  });
}

export function rejeitarBloco(
  execBlocoId: number,
  autor?: string,
  comentario?: string,
  voltarParaBlocoId?: string,
): Promise<unknown> {
  return pedido('POST', `/api/blocos/${execBlocoId}/rejeitar`, {
    autor: autor || undefined,
    comentario: comentario || undefined,
    voltarParaBlocoId: voltarParaBlocoId || undefined,
  });
}

/* ---------------------------- Extensões --------------------------- */

export function listarExtensoes(): Promise<ExtensaoResumo[]> {
  return pedido<ExtensaoResumo[]>('GET', '/api/extensoes');
}

export function obterExtensao(id: string): Promise<ExtensaoDetalhada> {
  return pedido<ExtensaoDetalhada>('GET', `/api/extensoes/${encodeURIComponent(id)}`);
}

export function instalarExtensao(caminho: string): Promise<{
  id: string;
  nome: string;
  versao: string;
  ativa: boolean;
  resumo: string;
  nota: string;
}> {
  return pedido('POST', '/api/extensoes/instalar', { caminho });
}

/**
 * O corpo real da API usa `consentido` (ver `src/api/routes.ts`); a
 * extensão arranca sempre inativa e só fica ativa com consentimento.
 */
export function consentirExtensao(
  id: string,
  consentido: boolean,
  nota?: string,
): Promise<{ id: string; ativa: boolean }> {
  return pedido('POST', `/api/extensoes/${encodeURIComponent(id)}/consentir`, {
    consentido,
    nota: nota || undefined,
  });
}

export function removerExtensao(id: string): Promise<{ removida: boolean }> {
  return pedido('DELETE', `/api/extensoes/${encodeURIComponent(id)}`);
}

/* ------------------------------- Jobs ----------------------------- */

export function jobsPendentes(): Promise<JobPendente[]> {
  return pedido<JobPendente[]>('GET', '/api/jobs/pendentes');
}

export function executarJobs(): Promise<ResumoExecucaoJobs> {
  return pedido<ResumoExecucaoJobs>('POST', '/api/jobs/executar');
}

export function repetirJob(id: number): Promise<{ id: number; estado: string }> {
  return pedido('POST', `/api/jobs/${id}/repetir`);
}

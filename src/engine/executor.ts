// Licensed under the Business Source License 1.1 — see LICENSE

// Executor de jobs de blocos automáticos (M2).
//
// Lê os jobs pendentes do `Banco`, resolve a capacidade da extensão
// responsável, invoca o módulo da extensão e regista o resultado como
// entrega tipada — ou agenda nova tentativa com backoff, ou falha o bloco
// com diagnóstico. Nunca "finge" sucesso: sem entrega válida não há bloco
// concluído.
//
// ── Nota honesta sobre segurança ─────────────────────────────────────
// O módulo da extensão corre in-process, no mesmo processo Node do núcleo,
// com acesso total ao runtime. A "restrição de efeitos" do protocolo v1 é
// declarativa (o manifesto lista `efeitos`) + consentimento explícito do
// utilizador na ativação — não é uma sandbox técnica. Confinamento real
// (worker isolado, permissões de ficheiros/rede) fica fora do âmbito do M2.
//
// ── Dependências injetadas ───────────────────────────────────────────
// O executor NÃO conhece o RegistoExtensoes concreto: recebe
// `resolverCapacidade` (ponte para o registo — encontra a capacidade
// compatível com o bloco) e `carregarModulo` (ponte para o carregamento —
// dynamic import do `mao.js` da extensão). O colega da API fará a ponte
// real; aqui tudo é testável com duplos.

import { concluirEntregaAutomatica, falhar } from './service.js';
import { validarValor, type Porta, type ValueShape } from '../contracts/index.js';
import type { Banco, DefinicaoBloco, JobPendente } from '../db/index.js';

/* ------------------------------------------------------------------ */
/* Tipos públicos do executor                                         */
/* ------------------------------------------------------------------ */

/** Capacidade de extensão resolvida para um bloco (contrato do M2). */
export interface CapacidadeResolvida {
  extensaoId: string;
  capacidadeId: string;
  /** Caminho do módulo a carregar (ex.: `<pasta-da-extensao>/mao.js`). */
  moduloCaminho: string;
  saidas: Porta[];
  efeitos: string[];
}

/** Critério com que se pede ao registo uma capacidade compatível. */
export interface CriterioCapacidade {
  operador: 'ia' | 'codigo';
  tipoBloco: string;
  processo: string;
}

/** Pontes injetadas: o executor não conhece o RegistoExtensoes. */
export interface DepsExecutor {
  resolverCapacidade: (
    extensaoId: string,
    criterio: CriterioCapacidade,
  ) => Promise<CapacidadeResolvida> | CapacidadeResolvida;
  carregarModulo: (
    caminho: string,
  ) => Promise<{ executar: (pedido: PedidoExecucao) => Promise<{ saidas: Record<string, unknown> }> }>;
}

/** Pedido entregue ao módulo da extensão. */
export interface PedidoExecucao {
  capacidadeId: string;
  extensaoId: string;
  bloco: {
    id: string;
    tipo: string;
    processo: string;
    titulo: string;
    parametros?: Record<string, unknown>;
  };
  /**
   * Valores encadeados a partir das entregas dos blocos anteriores do mesmo
   * projeto, mapeados pelas chaves das portas de entrada declaradas no
   * método. Chaves sem entrega correspondente são omitidas — nunca chegam
   * à extensão como `undefined`.
   */
  entradas: Record<string, unknown>;
  saidasDeclaradas: Porta[];
  efeitosDeclarados: string[];
}

export interface OpcoesExecutor {
  /** Nº máximo de tentativas por job (omissão 3). */
  maxTentativas?: number;
  /** Base do backoff exponencial em ms (omissão 5000). */
  esperaBaseMs?: number;
  /** Timeout por invocação da extensão em ms (omissão 120000). */
  timeoutMs?: number;
  /** Relógio injetável (testes deterministas). */
  agora?: () => Date;
  /**
   * Espera injetável (testes deterministas). É este `dormir` que dispara o
   * timeout — um duplo tem de o cumprir de forma fiel.
   */
  dormir?: (ms: number) => Promise<void>;
}

export type ResultadoJob = 'concluido' | 'falhado' | 'adiado' | 'ignorado';

export interface DetalheJob {
  jobId: number;
  resultado: ResultadoJob;
  detalhe?: string;
}

export interface ResumoExecucao {
  /** Jobs em que se tentou mesmo executar (exclui adiados). */
  executados: number;
  concluidos: number;
  falhados: number;
  /** Saltados porque `proximaExecucao` ainda está no futuro. */
  adiados: number;
  detalhes: DetalheJob[];
}

/* ------------------------------------------------------------------ */
/* Execução                                                            */
/* ------------------------------------------------------------------ */

const OMISSAO_MAX_TENTATIVAS = 3;
const OMISSAO_ESPERA_BASE_MS = 5000;
const OMISSAO_TIMEOUT_MS = 120000;

interface OpcoesResolvidas {
  maxTentativas: number;
  esperaBaseMs: number;
  timeoutMs: number;
  agora: () => Date;
  dormir: (ms: number) => Promise<void>;
}

// Corre os jobs pendentes, um de cada vez (ESPECIFICACAO-MVP.md §6: sem
// paralelismo no MVP). Um job envenenado não deita abaixo o lote: erros
// inesperados são contidos por job e contam como falha.
export async function executarJobsPendentes(
  banco: Banco,
  deps: DepsExecutor,
  opcoes: OpcoesExecutor = {},
): Promise<ResumoExecucao> {
  const resolvidas: OpcoesResolvidas = {
    maxTentativas: opcoes.maxTentativas ?? OMISSAO_MAX_TENTATIVAS,
    esperaBaseMs: opcoes.esperaBaseMs ?? OMISSAO_ESPERA_BASE_MS,
    timeoutMs: opcoes.timeoutMs ?? OMISSAO_TIMEOUT_MS,
    agora: opcoes.agora ?? (() => new Date()),
    dormir: opcoes.dormir ?? ((ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms))),
  };

  const resumo: ResumoExecucao = { executados: 0, concluidos: 0, falhados: 0, adiados: 0, detalhes: [] };
  const pendentes = banco.listarJobsPendentes();

  for (const job of pendentes) {
    let detalhe: DetalheJob;
    try {
      detalhe = await processarJob(banco, deps, job, resolvidas);
    } catch (erro) {
      // Defesa em profundidade: nunca abortar o lote por um job.
      const diagnostico = `erro interno do executor: ${mensagemErro(erro)}`;
      try {
        banco.atualizarJob(job.id, 'falhou', diagnostico);
      } catch {
        // O banco também falhou: nada mais a fazer por este job.
      }
      detalhe = { jobId: job.id, resultado: 'falhado', detalhe: diagnostico };
    }
    resumo.detalhes.push(detalhe);
    if (detalhe.resultado === 'adiado') {
      resumo.adiados += 1;
    } else {
      resumo.executados += 1;
      if (detalhe.resultado === 'concluido') resumo.concluidos += 1;
      else if (detalhe.resultado === 'falhado') resumo.falhados += 1;
      // 'ignorado' = tentativa falhou mas há retry agendado: conta como
      // executado, sem concluir nem falhar.
    }
  }
  return resumo;
}

async function processarJob(
  banco: Banco,
  deps: DepsExecutor,
  job: JobPendente,
  opcoes: OpcoesResolvidas,
): Promise<DetalheJob> {
  const { maxTentativas, esperaBaseMs, timeoutMs, agora, dormir } = opcoes;

  // (a) Backoff: job adiado até `proximaExecucao`.
  if (job.proximaExecucao && new Date(job.proximaExecucao).getTime() > agora().getTime()) {
    return { jobId: job.id, resultado: 'adiado', detalhe: `adiado até ${job.proximaExecucao}` };
  }

  // (b) Resolução da capacidade — erros aqui são de configuração: sem retry.
  // O `JobPendente` já traz o essencial do bloco (JOIN na camada db).
  const extensaoId = job.extensaoId ?? null;
  if (!extensaoId) {
    return falhaConfig(
      banco,
      job,
      `o bloco '${job.blocoId}' não tem extensão associada`,
    );
  }
  let capacidade: CapacidadeResolvida;
  try {
    capacidade = await deps.resolverCapacidade(extensaoId, {
      operador: job.operador,
      tipoBloco: job.tipo,
      processo: job.processo,
    });
  } catch (erro) {
    return falhaConfig(
      banco,
      job,
      `não foi possível resolver capacidade da extensão '${extensaoId}': ${mensagemErro(erro)}`,
    );
  }

  // (c) Pedido à extensão. Os `parametros` vêm da definição do bloco no
  // snapshot imutável do projeto; as `entradas` são encadeadas a partir das
  // entregas dos blocos anteriores do mesmo projeto (M3).
  const definicao = banco.obterDefinicaoBloco(job.projetoId, job.processo, job.blocoId);
  const pedido: PedidoExecucao = {
    capacidadeId: capacidade.capacidadeId,
    extensaoId: capacidade.extensaoId,
    bloco: {
      id: job.blocoId,
      tipo: job.tipo,
      processo: job.processo,
      titulo: job.titulo,
      ...(definicao?.parametros === undefined ? {} : { parametros: definicao.parametros }),
    },
    entradas: construirEntradas(banco, job, definicao?.entradas ?? []),
    saidasDeclaradas: capacidade.saidas,
    efeitosDeclarados: capacidade.efeitos,
  };

  // (d) Invocação com timeout.
  banco.atualizarJob(job.id, 'em_curso');
  let resposta: unknown;
  try {
    const modulo = await deps.carregarModulo(capacidade.moduloCaminho);
    if (!modulo || typeof modulo.executar !== 'function') {
      throw new Error(`o módulo '${capacidade.moduloCaminho}' não expõe a função 'executar'`);
    }
    resposta = await comTimeout(modulo.executar(pedido), timeoutMs, dormir);
  } catch (erro) {
    return falhaTransitoria(
      banco,
      job,
      `a extensão '${extensaoId}' falhou: ${mensagemErro(erro)}`,
      { maxTentativas, esperaBaseMs, agora },
    );
  }

  // (e) Validação da resposta contra o contrato declarado.
  const violacoes = validarResposta(resposta, capacidade.saidas);
  if (violacoes.length > 0) {
    return falhaTransitoria(
      banco,
      job,
      `a extensão '${extensaoId}' violou o contrato: ${violacoes.join('; ')}`,
      { maxTentativas, esperaBaseMs, agora },
    );
  }

  // (f) Sucesso: regista as entregas e conclui bloco + job.
  const saidas = (resposta as { saidas: Record<string, unknown> }).saidas;
  const itens = capacidade.saidas.map((porta) => ({ tipo: porta as unknown, valor: saidas[porta.chave] }));
  try {
    concluirEntregaAutomatica(banco, job.execBlocoId, itens);
  } catch (erro) {
    // Determinístico: o contrato do método e o da capacidade divergem;
    // repetir não ajuda — falha final, sem retry.
    return falhaFinal(
      banco,
      job,
      `divergência entre o método e a capacidade '${capacidade.capacidadeId}': ${mensagemErro(erro)}`,
    );
  }
  banco.atualizarJob(job.id, 'concluido');
  return { jobId: job.id, resultado: 'concluido' };
}

// Preenche as entradas do bloco com as entregas dos blocos anteriores do
// mesmo projeto: para cada porta de entrada declarada, usa-se a entrega
// mais recente de um bloco anterior (id de execução menor) cuja porta de
// saída tenha a mesma chave. "Anterior" = criado antes na ordem do fluxo,
// o que no MVP coincide com a ordem de execução (um bloco de cada vez).
function construirEntradas(
  banco: Banco,
  job: JobPendente,
  portasEntrada: Porta[],
): Record<string, unknown> {
  const entradas: Record<string, unknown> = {};
  if (portasEntrada.length === 0) return entradas;
  const entregas = banco.listarEntregas(job.projetoId);
  for (const porta of portasEntrada) {
    const chave = porta.chave;
    for (let i = entregas.length - 1; i >= 0; i--) {
      const entrega = entregas[i];
      if (entrega.execBlocoId >= job.execBlocoId) continue; // só blocos anteriores
      const tipo = entrega.tipo;
      if (
        typeof tipo === 'object' &&
        tipo !== null &&
        (tipo as { chave?: unknown }).chave === chave
      ) {
        entradas[chave] = entrega.valor;
        break;
      }
    }
  }
  return entradas;
}

// Erro de configuração (extensão ausente/inativa, nenhuma/ambígua
// capacidade compatível, bloco sem extensão): sem retry — o job falha de
// imediato e o bloco recebe o diagnóstico.
function falhaConfig(banco: Banco, job: JobPendente, diagnostico: string): DetalheJob {
  const detalhe = `erro de configuração (sem nova tentativa): ${diagnostico}`;
  banco.atualizarJob(job.id, 'falhou', detalhe);
  marcarBlocoFalhado(banco, job.execBlocoId, diagnostico);
  return { jobId: job.id, resultado: 'falhado', detalhe };
}

// Falha transitória (exceção, timeout, violação de contrato): nova tentativa
// com backoff enquanto houver tentativas; esgotadas, falha final.
// Nunca finge sucesso.
function falhaTransitoria(
  banco: Banco,
  job: JobPendente,
  diagnostico: string,
  opcoes: { maxTentativas: number; esperaBaseMs: number; agora: () => Date },
): DetalheJob {
  const tentativas = banco.incrementarTentativaJob(job.id);
  if (tentativas < opcoes.maxTentativas) {
    const esperaMs = opcoes.esperaBaseMs * 2 ** tentativas;
    const proxima = new Date(opcoes.agora().getTime() + esperaMs).toISOString();
    banco.definirProximaExecucaoJob(job.id, proxima);
    const detalhe =
      `${diagnostico} — nova tentativa ${tentativas + 1}/${opcoes.maxTentativas} ` +
      `agendada após ${esperaMs}ms (${proxima})`;
    banco.atualizarJob(job.id, 'pendente', detalhe);
    return { jobId: job.id, resultado: 'ignorado', detalhe };
  }
  return falhaFinal(
    banco,
    job,
    `${diagnostico} (tentativas esgotadas: ${tentativas}/${opcoes.maxTentativas})`,
  );
}

function falhaFinal(banco: Banco, job: JobPendente, diagnostico: string): DetalheJob {
  banco.atualizarJob(job.id, 'falhou', diagnostico);
  marcarBlocoFalhado(banco, job.execBlocoId, diagnostico);
  return { jobId: job.id, resultado: 'falhado', detalhe: diagnostico };
}

// Leva o bloco a 'falhou' com o diagnóstico, se ainda estiver em voo.
// (Se já saiu de 'em_curso'/'aguardar_aprovacao', a intenção 'falhar' não se
// aplica — regista-se só no job.)
function marcarBlocoFalhado(banco: Banco, execBlocoId: number, diagnostico: string): void {
  const bloco = banco.obterExecBloco(execBlocoId);
  if (bloco && (bloco.estado === 'em_curso' || bloco.estado === 'aguardar_aprovacao')) {
    falhar(banco, execBlocoId, diagnostico);
  }
}

// Valida a resposta do módulo contra as saídas declaradas da capacidade.
// Devolve a lista de violações (vazia = resposta válida).
function validarResposta(resposta: unknown, saidasDeclaradas: Porta[]): string[] {
  if (typeof resposta !== 'object' || resposta === null || Array.isArray(resposta)) {
    return ['a resposta da extensão tem de ser um objeto com `saidas`'];
  }
  const saidas = (resposta as { saidas?: unknown }).saidas;
  if (typeof saidas !== 'object' || saidas === null || Array.isArray(saidas)) {
    return ['a resposta da extensão tem de incluir `saidas` como objeto'];
  }
  const violacoes: string[] = [];
  const mapa = saidas as Record<string, unknown>;
  for (const porta of saidasDeclaradas) {
    if (!Object.hasOwn(mapa, porta.chave)) {
      violacoes.push(`saída em falta: '${porta.chave}'`);
      continue;
    }
    const erros = validarValor(porta.tipo as ValueShape, mapa[porta.chave], porta.chave);
    if (!Array.isArray(erros)) {
      violacoes.push(`saída '${porta.chave}': forma de saída irreconhecível`);
    } else {
      for (const erro of erros) violacoes.push(`saída '${porta.chave}': ${erro}`);
    }
  }
  return violacoes;
}

// Corre a tarefa com timeout. O `dormir` injetado permite testes
// deterministas; por omissão usa temporizador real.
async function comTimeout<T>(
  tarefa: Promise<T>,
  timeoutMs: number,
  dormir: (ms: number) => Promise<void>,
): Promise<T> {
  // Evita "unhandled rejection" se a extensão responder depois do timeout.
  tarefa.catch(() => {});
  return Promise.race([
    tarefa,
    dormir(timeoutMs).then((): T => {
      throw new Error('tempo de execução esgotado');
    }),
  ]);
}

function mensagemErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

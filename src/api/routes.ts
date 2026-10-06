// Licensed under the Business Source License 1.1 — see LICENSE

/**
 * Router da API local (JSON) do núcleo.
 *
 * Expõe canais, métodos, projetos, execuções de blocos, aprovações e
 * entregas sobre HTTP. Sem autenticação: destina-se a `localhost` (MVP).
 *
 * Convenções de resposta:
 * - corpo sempre em `application/json`;
 * - pedido inválido → 400 `{ erro: string }`;
 * - recurso inexistente → 404 `{ erro: string }`;
 * - falha inesperada → 500 `{ erro: string }`.
 *
 * NOTA DE INTEGRAÇÃO (M1): o módulo `../engine/service.js` é entregue pelo
 * colega do motor com exatamente as assinaturas usadas aqui
 * (`criarProjeto`, `avancar`, `submeterEntrega`, `aprovar`, `rejeitar`).
 * (O motor também expõe `estadoProjeto`, que devolve o mesmo detalhe que
 * `banco.obterProjeto`; a rota de detalhe usa o banco diretamente.)
 * A validação do corpo do método usa o `MetodoDefSchema` real de
 * `../contracts/index.js` (fonte de verdade da gramática): cobre tipos de
 * bloco, operadores, portas tipadas, `VALIDAR` só com operador humano,
 * `extensaoId` obrigatório para `ia`/`codigo` e ids de bloco únicos.
 *
 * NOTA DE INTEGRAÇÃO (M2): as rotas de extensões e jobs usam o
 * `RegistoExtensoes` real (`src/extensoes/registo.ts`) e a ponte real
 * `criarDepsExecutor()` de `./extensoes.js` para o executor
 * (`executarJobsPendentes` de `src/engine/executor.ts`). Para testes,
 * `OpcoesRouter` permite injetar executor, diretório de extensões e opções
 * do executor.
 */

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Banco } from '../db/index.js';
import { MetodoDefSchema, ProcessoIdSchema } from '../contracts/index.js';
import {
  avancar,
  aprovar,
  criarProjeto,
  rejeitar,
  submeterEntrega,
} from '../engine/service.js';
import { executarJobsPendentes, type OpcoesExecutor } from '../engine/executor.js';
import type { RegistoExtensoes } from '../extensoes/registo.js';
import { criarDepsExecutor, type ExecutarJobsFn } from './extensoes.js';

/* ------------------------------------------------------------------ */
/* Validação (zod)                                                    */
/* ------------------------------------------------------------------ */

/**
 * Corpo do `PUT /api/canais/:id/metodos`: é exatamente um `MetodoDef`
 * (definição de um método para um único processo). A versão é sempre
 * atribuída pelo banco — se o cliente enviar `versao`, é ignorada.
 */

const CriarCanalSchema = z
  .object({
    nome: z.string().min(1, 'O nome do canal não pode estar vazio.'),
    ordemProcessos: z
      .array(ProcessoIdSchema)
      .length(8, 'A ordem do canal tem de conter exatamente 8 processos.'),
  })
  .superRefine((canal, ctx) => {
    if (new Set(canal.ordemProcessos).size !== canal.ordemProcessos.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A ordem do canal contém processos repetidos.',
        path: ['ordemProcessos'],
      });
    }
  });

const CriarProjetoSchema = z.object({
  canalId: z.number().int().positive('O canalId tem de ser um inteiro positivo.'),
  nome: z.string().min(1, 'O nome do projeto não pode estar vazio.'),
});

const EntregaSchema = z.object({
  valor: z
    .unknown()
    .refine((v) => v !== undefined, { message: 'O campo "valor" é obrigatório.' }),
  autor: z.string().optional(),
});

const VereditoSchema = z.object({
  autor: z.string().optional(),
  comentario: z.string().optional(),
});

const RejeicaoSchema = VereditoSchema.extend({
  voltarParaBlocoId: z.string().min(1).optional(),
});

const InstalarExtensaoSchema = z.object({
  caminho: z.string().min(1, 'O campo "caminho" é obrigatório e não pode estar vazio.'),
});

const ConsentimentoSchema = z.object({
  consentido: z.boolean({
    invalid_type_error: 'O campo "consentido" tem de ser um booleano.',
    required_error: 'O campo "consentido" é obrigatório.',
  }),
  nota: z.string().optional(),
});

function resumirErrosZod(erro: z.ZodError): string {
  return erro.issues
    .map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`)
    .join('; ');
}

/* ------------------------------------------------------------------ */
/* Erros e utilitários                                                */
/* ------------------------------------------------------------------ */

/** Erro com estado HTTP associado (400/404/500). */
class ErroApi extends Error {
  constructor(
    public readonly estado: number,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

type Manipulador = (req: express.Request, res: express.Response) => unknown;

/** Converte exceções dos manipuladores em respostas JSON de erro. */
function envolver(fn: Manipulador): express.RequestHandler {
  return (req, res, next) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch(next);
  };
}

/** Lê um parâmetro de rota como id inteiro positivo (400 se inválido). */
function idDaRota(req: express.Request, nome = 'id'): number {
  const bruto = req.params[nome];
  const n = Number(bruto);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ErroApi(400, `Identificador inválido: '${bruto}'.`);
  }
  return n;
}

/** Devolve o bloco de execução ou lança 404. */
function blocoOu404(banco: Banco, execBlocoId: number) {
  const bloco = banco.obterExecBloco(execBlocoId);
  if (!bloco) {
    throw new ErroApi(404, `O bloco de execução ${execBlocoId} não existe.`);
  }
  return bloco;
}

/** Opções extra do router (M2): injeção para testes e diretório de extensões. */
export interface OpcoesRouter {
  /** Substitui o executor real (testes). */
  executarJobs?: ExecutarJobsFn;
  /** Opções passadas ao executor (`maxTentativas`, `dormir`, …). */
  executarOpcoes?: OpcoesExecutor;
  /** Destino das extensões instaladas (omissão: `./extensoes`). */
  dirExtensoes?: string;
}

/**
 * Devolve o registo de extensões ou lança 503 quando o módulo do colega
 * (`src/extensoes/registo.ts`) ainda não foi entregue.
 */
function registoOu503(registo: RegistoExtensoes | null): RegistoExtensoes {
  if (!registo) {
    throw new ErroApi(
      503,
      'Registo de extensões indisponível: o módulo src/extensoes/registo.ts ainda não foi entregue.',
    );
  }
  return registo;
}

/**
 * Converte erros lançados pelo registo em `ErroApi` com o estado certo.
 * O registo comunica por exceções com mensagens em pt-PT; o mapeamento é
 * por padrões estáveis dessas mensagens.
 */
function erroRegistoParaHttp(erro: unknown, contexto: 'instalar' | 'pesquisa'): ErroApi {
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  if (/já está instalada/i.test(mensagem)) {
    return new ErroApi(409, mensagem);
  }
  if (contexto === 'pesquisa' && /não está instalada/i.test(mensagem)) {
    return new ErroApi(404, mensagem);
  }
  return new ErroApi(400, mensagem);
}

/** Identificador de extensão vindo da rota: texto não vazio (não numérico). */
function idExtensaoDaRota(req: express.Request): string {
  const id = req.params['id'];
  if (typeof id !== 'string' || id.trim() === '') {
    throw new ErroApi(400, `Identificador de extensão inválido: '${id}'.`);
  }
  return id;
}

/**
 * Normaliza o resultado de `criarProjeto` do motor para um id numérico.
 * Aceita id direto, `{ id }` ou `ProjetoDetalhado`.
 */
function extrairIdProjeto(resultado: unknown): number {
  if (typeof resultado === 'number' && Number.isInteger(resultado) && resultado > 0) {
    return resultado;
  }
  if (resultado !== null && typeof resultado === 'object') {
    const r = resultado as { id?: unknown; projeto?: { id?: unknown } | null };
    if (typeof r.id === 'number' && Number.isInteger(r.id) && r.id > 0) {
      return r.id;
    }
    if (r.projeto && typeof r.projeto.id === 'number' && Number.isInteger(r.projeto.id)) {
      return r.projeto.id;
    }
  }
  throw new ErroApi(500, 'O motor devolveu um resultado inesperado ao criar o projeto.');
}

function tratarErros(
  erro: unknown,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction,
): void {
  if (erro instanceof ErroApi) {
    res.status(erro.estado).json({ erro: erro.message });
    return;
  }
  if (erro instanceof SyntaxError) {
    const comTipo = erro as { type?: unknown };
    if (comTipo.type === 'entity.parse.failed') {
      res.status(400).json({ erro: 'Corpo JSON inválido.' });
      return;
    }
  }
  if (erro instanceof Error) {
    // Erros de domínio (banco, motor, validações) → 400 com a mensagem.
    res.status(400).json({ erro: erro.message });
    return;
  }
  res.status(500).json({ erro: 'Erro interno inesperado.' });
}

/* ------------------------------------------------------------------ */
/* Router                                                             */
/* ------------------------------------------------------------------ */

/**
 * Cria o router da API local ligado ao banco fornecido.
 *
 * `registo` é o `RegistoExtensoes` do colega (M2); pode ser `null` enquanto
 * o módulo não for entregue — nesse caso as rotas de extensões e a
 * execução de jobs respondem 503 com mensagem clara. `opcoes.executarJobs`
 * injeta um executor (usado nos testes com um duplo).
 */
export function criarRouter(
  banco: Banco,
  registo: RegistoExtensoes | null,
  opcoes: OpcoesRouter = {},
): express.Router {
  const router = express.Router();
  const dirExtensoes = opcoes.dirExtensoes ?? './extensoes';

  /* ------------------------------ Canais ------------------------------ */

  router.post(
    '/api/canais',
    envolver((req, res) => {
      const corpo = CriarCanalSchema.safeParse(req.body);
      if (!corpo.success) {
        throw new ErroApi(400, `Corpo inválido: ${resumirErrosZod(corpo.error)}`);
      }
      const canal = banco.criarCanal(corpo.data.nome, corpo.data.ordemProcessos);
      res.status(201).json({ id: canal.id, nome: canal.nome });
    }),
  );

  router.get(
    '/api/canais',
    envolver((_req, res) => {
      res.json(banco.listarCanais());
    }),
  );

  router.get(
    '/api/canais/:id',
    envolver((req, res) => {
      const id = idDaRota(req);
      const canal = banco.obterCanal(id);
      if (!canal) {
        throw new ErroApi(404, `O canal ${id} não existe.`);
      }
      const metodos: Record<string, unknown> = {};
      for (const processo of canal.ordemProcessos) {
        metodos[processo] = banco.obterMetodoVigente(id, processo) ?? null;
      }
      res.json({ ...canal, metodos });
    }),
  );

  router.put(
    '/api/canais/:id/metodos',
    envolver((req, res) => {
      const id = idDaRota(req);
      if (!banco.obterCanal(id)) {
        throw new ErroApi(404, `O canal ${id} não existe.`);
      }
      const corpo = MetodoDefSchema.safeParse(req.body);
      if (!corpo.success) {
        throw new ErroApi(400, `Método inválido: ${resumirErrosZod(corpo.error)}`);
      }
      const versao = banco.guardarMetodo(id, {
        processo: corpo.data.processo,
        blocos: corpo.data.blocos,
      });
      res.json({ processo: corpo.data.processo, versao });
    }),
  );

  /* ----------------------------- Projetos ----------------------------- */

  router.post(
    '/api/projetos',
    envolver((req, res) => {
      const corpo = CriarProjetoSchema.safeParse(req.body);
      if (!corpo.success) {
        throw new ErroApi(400, `Corpo inválido: ${resumirErrosZod(corpo.error)}`);
      }
      if (!banco.obterCanal(corpo.data.canalId)) {
        throw new ErroApi(404, `O canal ${corpo.data.canalId} não existe.`);
      }
      const resultado = criarProjeto(banco, corpo.data.canalId, corpo.data.nome);
      res.status(201).json({ id: extrairIdProjeto(resultado) });
    }),
  );

  router.get(
    '/api/projetos',
    envolver((_req, res) => {
      res.json(banco.listarProjetos());
    }),
  );

  router.get(
    '/api/projetos/:id',
    envolver((req, res) => {
      const id = idDaRota(req);
      const detalhe = banco.obterProjeto(id);
      if (!detalhe) {
        throw new ErroApi(404, `O projeto ${id} não existe.`);
      }
      // O detalhe já inclui projeto, processos, blocos e respetivos estados.
      res.json(detalhe);
    }),
  );

  router.post(
    '/api/projetos/:id/avancar',
    envolver((req, res) => {
      const id = idDaRota(req);
      if (!banco.obterProjeto(id)) {
        throw new ErroApi(404, `O projeto ${id} não existe.`);
      }
      const resultado = avancar(banco, id);
      res.json(resultado ?? { ok: true });
    }),
  );

  router.get(
    '/api/projetos/:id/entregas',
    envolver((req, res) => {
      const id = idDaRota(req);
      if (!banco.obterProjeto(id)) {
        throw new ErroApi(404, `O projeto ${id} não existe.`);
      }
      res.json(banco.listarEntregas(id));
    }),
  );

  /* ------------------------- Blocos de execução ------------------------ */

  router.post(
    '/api/blocos/:execBlocoId/entrega',
    envolver((req, res) => {
      const execBlocoId = idDaRota(req, 'execBlocoId');
      blocoOu404(banco, execBlocoId);
      const corpo = EntregaSchema.safeParse(req.body);
      if (!corpo.success) {
        throw new ErroApi(400, `Corpo inválido: ${resumirErrosZod(corpo.error)}`);
      }
      const resultado = submeterEntrega(banco, execBlocoId, corpo.data.valor, corpo.data.autor);
      res.json(resultado ?? { ok: true, execBlocoId });
    }),
  );

  router.post(
    '/api/blocos/:execBlocoId/aprovar',
    envolver((req, res) => {
      const execBlocoId = idDaRota(req, 'execBlocoId');
      blocoOu404(banco, execBlocoId);
      const corpo = VereditoSchema.safeParse(req.body ?? {});
      if (!corpo.success) {
        throw new ErroApi(400, `Corpo inválido: ${resumirErrosZod(corpo.error)}`);
      }
      const resultado = aprovar(banco, execBlocoId, {
        autor: corpo.data.autor,
        comentario: corpo.data.comentario,
      });
      res.json(resultado ?? { ok: true, execBlocoId });
    }),
  );

  router.post(
    '/api/blocos/:execBlocoId/rejeitar',
    envolver((req, res) => {
      const execBlocoId = idDaRota(req, 'execBlocoId');
      blocoOu404(banco, execBlocoId);
      const corpo = RejeicaoSchema.safeParse(req.body ?? {});
      if (!corpo.success) {
        throw new ErroApi(400, `Corpo inválido: ${resumirErrosZod(corpo.error)}`);
      }
      const resultado = rejeitar(banco, execBlocoId, {
        autor: corpo.data.autor,
        comentario: corpo.data.comentario,
        voltarParaBlocoId: corpo.data.voltarParaBlocoId,
      });
      res.json(resultado ?? { ok: true, execBlocoId });
    }),
  );

  /* ---------------------------- Extensões ----------------------------- */

  router.post(
    '/api/extensoes/instalar',
    envolver((req, res) => {
      const r = registoOu503(registo);
      const corpo = InstalarExtensaoSchema.safeParse(req.body ?? {});
      if (!corpo.success) {
        throw new ErroApi(400, `Corpo inválido: ${resumirErrosZod(corpo.error)}`);
      }
      // O caminho resolve-se contra o diretório de trabalho do servidor.
      const origem = path.resolve(corpo.data.caminho);
      if (!fs.existsSync(origem)) {
        throw new ErroApi(400, `O caminho '${corpo.data.caminho}' não existe.`);
      }
      // Lê o id do manifesto para detetar duplicados (409) antes de instalar.
      let idManifesto: string | undefined;
      try {
        const manifestoBruto = JSON.parse(
          fs.readFileSync(path.join(origem, 'extensao.json'), 'utf8'),
        ) as { id?: unknown };
        if (typeof manifestoBruto.id === 'string' && manifestoBruto.id.trim() !== '') {
          idManifesto = manifestoBruto.id;
        }
      } catch {
        // O instalar valida o manifesto e devolve 400 com o detalhe.
      }
      if (idManifesto) {
        let existente = null;
        try {
          existente = r.obter(idManifesto) ?? null;
        } catch {
          existente = null;
        }
        if (existente) {
          throw new ErroApi(409, `A extensão '${idManifesto}' já está instalada.`);
        }
      }
      let resultado;
      try {
        resultado = r.instalar(origem, dirExtensoes);
      } catch (erro) {
        throw erroRegistoParaHttp(erro, 'instalar');
      }
      // O resumo serve para revisão humana antes do consentimento; a
      // extensão arranca sempre inativa.
      res.status(201).json({
        id: resultado.manifesto.id,
        nome: resultado.manifesto.nome,
        versao: resultado.manifesto.versao,
        ativa: false,
        resumo: resultado.resumo,
        nota: resultado.nota,
      });
    }),
  );

  router.get(
    '/api/extensoes',
    envolver((_req, res) => {
      const r = registoOu503(registo);
      res.json(
        r.listar().map((e) => ({
          id: e.id,
          nome: e.nome,
          versao: e.versao,
          ativa: e.ativa,
          capacidades: e.capacidades.length,
        })),
      );
    }),
  );

  router.get(
    '/api/extensoes/:id',
    envolver((req, res) => {
      const r = registoOu503(registo);
      const id = idExtensaoDaRota(req);
      let extensao;
      try {
        extensao = r.obter(id);
      } catch (erro) {
        throw erroRegistoParaHttp(erro, 'pesquisa');
      }
      if (!extensao) {
        throw new ErroApi(404, `A extensão '${id}' não está instalada.`);
      }
      // O detalhe completo inclui o manifesto instalado (fonte do runtime).
      let manifesto: unknown = null;
      try {
        manifesto = JSON.parse(
          fs.readFileSync(path.join(extensao.caminho, 'extensao.json'), 'utf8'),
        );
      } catch {
        manifesto = null;
      }
      res.json({
        id: extensao.id,
        nome: extensao.nome,
        versao: extensao.versao,
        autor: extensao.autor,
        licenca: extensao.licenca,
        ativa: extensao.ativa,
        caminho: extensao.caminho,
        instaladaEm: extensao.instaladaEm,
        notaConsentimento: extensao.notaConsentimento,
        manifesto,
        capacidades: extensao.capacidades,
      });
    }),
  );

  router.post(
    '/api/extensoes/:id/consentir',
    envolver((req, res) => {
      const r = registoOu503(registo);
      const id = idExtensaoDaRota(req);
      const corpo = ConsentimentoSchema.safeParse(req.body ?? {});
      if (!corpo.success) {
        throw new ErroApi(400, `Corpo inválido: ${resumirErrosZod(corpo.error)}`);
      }
      try {
        r.definirConsentimento(id, corpo.data.consentido, corpo.data.nota);
      } catch (erro) {
        throw erroRegistoParaHttp(erro, 'pesquisa');
      }
      // Sem consentimento a extensão fica (ou volta a ficar) inativa.
      let ativa = corpo.data.consentido;
      try {
        const extensao = r.obter(id);
        if (extensao) {
          ativa = extensao.ativa;
        }
      } catch {
        // Estado já aplicado; segue com o valor pedido.
      }
      res.json({ id, ativa });
    }),
  );

  router.delete(
    '/api/extensoes/:id',
    envolver((req, res) => {
      const r = registoOu503(registo);
      const id = idExtensaoDaRota(req);
      try {
        r.remover(id);
      } catch (erro) {
        throw erroRegistoParaHttp(erro, 'pesquisa');
      }
      res.json({ removida: true });
    }),
  );

  /* ------------------------------- Jobs ------------------------------- */

  router.get(
    '/api/jobs/pendentes',
    envolver((_req, res) => {
      res.json(
        banco.listarJobsPendentes().map((j) => {
          const projeto = banco.obterProjeto(j.projetoId);
          return {
            id: j.jobId,
            estado: 'pendente',
            operador: j.operador,
            execBlocoId: j.execBlocoId,
            bloco: {
              blocoId: j.blocoId,
              titulo: j.titulo,
              tipo: j.tipo,
              processo: j.processo,
              extensaoId: j.extensaoId,
              tentativa: j.tentativa,
            },
            projetoId: j.projetoId,
            projeto: projeto?.projeto.nome ?? null,
            tentativasJob: j.tentativasJob,
          };
        }),
      );
    }),
  );

  router.post(
    '/api/jobs/executar',
    envolver(async (_req, res) => {
      const r = registoOu503(registo);
      const executar: ExecutarJobsFn = opcoes.executarJobs ?? executarJobsPendentes;
      const resumo = await executar(banco, criarDepsExecutor(r), opcoes.executarOpcoes ?? {});
      res.json(resumo);
    }),
  );

  router.post(
    '/api/jobs/:id/repetir',
    envolver((req, res) => {
      const id = idDaRota(req);
      try {
        banco.atualizarJob(id, 'pendente', 'Repetição pedida via API.');
      } catch (erro) {
        const mensagem = erro instanceof Error ? erro.message : String(erro);
        if (/não existe/i.test(mensagem)) {
          throw new ErroApi(404, `O job ${id} não existe.`);
        }
        throw erro;
      }
      // Limpa o backoff agendado pelo executor, se existir.
      banco.definirProximaExecucaoJob(id, null);
      res.json({ id, estado: 'pendente' });
    }),
  );

  /* --------------------------- Fallbacks ------------------------------ */

  // O 404 genérico só reclama rotas da API: fora de `/api/*` passa à
  // frente, para o servidor poder montar a UI estática depois do router
  // (M3 — `server/index.ts`).
  router.use('/api', (_req, res) => {
    res.status(404).json({ erro: 'Rota não encontrada.' });
  });

  router.use(tratarErros);

  return router;
}

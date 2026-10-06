// Licensed under the Business Source License 1.1 — see ../../LICENSE-DRAFT.md

/**
 * "Ponte Drift" — extensão do Wild Studio que monta e exporta o vídeo final
 * no CutWire Drift (editor gratuito e open-source) através do servidor MCP
 * local do Drift.
 *
 * Capacidade `montar-e-exportar` (operador `codigo`, bloco CRIAR, processo
 * `edicao`): recebe narração, clips, legendas SRT, título e parâmetros;
 * lança o Drift em headless, monta a timeline via MCP
 * (catalog → apply → inspect → export_video com poll) e devolve o MP4.
 *
 * Contrato:
 * - pedido: `{ entradas: { narracao?, clips?, legendas?, titulo?, parametros? },
 *              bloco: { parametros?: {...} }, ... }`
 *   Os artefactos chegam como `{ id }` (convenção do núcleo) — esta extensão
 *   interpreta o `id` como **caminho absoluto do ficheiro** (ver README.md,
 *   "Convenção de artefactos"). Aceita ainda strings com caminhos e objetos
 *   `{ caminho }`, por tolerância.
 * - resposta: `{ saidas: { video_final: { id: <caminho absoluto do MP4> } } }`
 *   (casa com a porta `video_final`: video / um / artefacto).
 *
 * Configuração (parâmetros do bloco → variáveis de ambiente → omissões):
 * - `drift_path` / DRIFT_PATH — executável do Drift (omissão: "drift" no PATH)
 * - `modo` / DRIFT_MODO — "headless" (omissão) ou "acoplado" (usa editor aberto)
 * - `mcp_port` / DRIFT_MCP_PORT — omissão 4731
 * - `mcp_token` / DRIFT_MCP_TOKEN — só preciso no modo acoplado (o token da
 *   sessão copia-se de Settings → Agent access no Drift)
 * - `versao_minima` / DRIFT_VERSAO_MINIMA — omissão "0.7.5"
 * - `duracao_cena` / DRIFT_DURACAO_CENA — segundos por cena (omissão 3)
 * - `transicao` / DRIFT_TRANSICAO — "nenhuma" (omissão), "fade" ou "dissolve"
 * - `formato` / DRIFT_FORMATO — "9:16" (omissão) ou "16:9"
 *
 * Sem dependências npm: só módulos nativos do Node 22+ (`fetch` global).
 *
 * Nota de protocolo: os nomes exatos das operações de timeline do Drift
 * evoluem (v0.7.5 é inicial). A extensão descobre-as em runtime via
 * `catalog`/`search` e falha de forma explícita quando uma operação
 * essencial não existe — nunca adivinha em silêncio.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute, resolve } from 'node:path';
import { setTimeout as dormirMs } from 'node:timers/promises';

/* ------------------------------------------------------------------ */
/* Erros                                                              */
/* ------------------------------------------------------------------ */

/**
 * Erro de configuração/diagnóstico determinístico: ficheiro em falta,
 * versão incompatível, operação inexistente no catálogo, MP4 inválido.
 * No protocolo v1 o executor volta a tentar qualquer exceção da extensão,
 * mas estes erros falham sempre da mesma forma e depressa (a validação
 * acontece antes de lançar o Drift), por isso o diagnóstico final diz
 * exatamente o que corrigir.
 */
class ErroConfig extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroConfig';
  }
}

/**
 * Erro devolvido pelo Drift dentro do resultado da ferramenta:
 * `{ ok:false, error:<codigo>, detail }`.
 */
class ErroDrift extends Error {
  constructor(codigo, detalhe) {
    super(detalhe ? `${codigo}: ${detalhe}` : codigo);
    this.name = 'ErroDrift';
    this.codigo = codigo;
  }
}

/* ------------------------------------------------------------------ */
/* Configuração                                                       */
/* ------------------------------------------------------------------ */

const OMISSOES = {
  driftPath: 'drift',
  modo: 'headless',
  mcpPort: 4731,
  versaoMinima: '0.7.5',
  duracaoCena: 3,
  transicao: 'nenhuma',
  formato: '9:16',
  timeoutChamadaMs: 30000,
  timeoutExportacaoMs: 600000,
  intervaloPollMs: 2000,
};

function lerTexto(valor) {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : undefined;
}

function lerNumero(valor, omissao) {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : omissao;
}

/** Parâmetros do bloco → env → omissões. */
function lerConfig(pedido) {
  const p = pedido?.bloco?.parametros ?? {};
  const env = process.env;
  const cfg = {
    driftPath: lerTexto(p.drift_path) ?? lerTexto(env.DRIFT_PATH) ?? OMISSOES.driftPath,
    modo: lerTexto(p.modo) ?? lerTexto(env.DRIFT_MODO) ?? OMISSOES.modo,
    mcpPort: lerNumero(p.mcp_port ?? env.DRIFT_MCP_PORT, OMISSOES.mcpPort),
    mcpToken:
      lerTexto(p.mcp_token) ??
      lerTexto(env.DRIFT_MCP_TOKEN) ??
      lerTexto(env.DRIFT_BRIDGE_TOKEN),
    versaoMinima:
      lerTexto(p.versao_minima) ?? lerTexto(env.DRIFT_VERSAO_MINIMA) ?? OMISSOES.versaoMinima,
    duracaoCena: lerNumero(p.duracao_cena ?? env.DRIFT_DURACAO_CENA, OMISSOES.duracaoCena),
    transicao: lerTexto(p.transicao) ?? lerTexto(env.DRIFT_TRANSICAO) ?? OMISSOES.transicao,
    formato: lerTexto(p.formato) ?? lerTexto(env.DRIFT_FORMATO) ?? OMISSOES.formato,
    presetExportacao: lerTexto(p.preset_exportacao) ?? lerTexto(env.DRIFT_PRESET_EXPORTACAO),
    tituloDuracao: lerNumero(p.titulo_duracao ?? env.DRIFT_TITULO_DURACAO, 3),
    timeoutChamadaMs: lerNumero(env.DRIFT_BRIDGE_TIMEOUT_CHAMADA_MS, OMISSOES.timeoutChamadaMs),
    timeoutExportacaoMs: lerNumero(
      env.DRIFT_BRIDGE_TIMEOUT_EXPORTACAO_MS,
      OMISSOES.timeoutExportacaoMs,
    ),
    intervaloPollMs: lerNumero(env.DRIFT_BRIDGE_INTERVALO_POLL_MS, OMISSOES.intervaloPollMs),
    semLancar: env.DRIFT_BRIDGE_SEM_LANCAR === '1',
    // Durações por cena (array de segundos); se ausente usa duracaoCena para todas.
    duracoes: Array.isArray(p.duracoes)
      ? p.duracoes.filter((d) => Number.isFinite(d) && d > 0)
      : undefined,
  };
  if (!['headless', 'acoplado'].includes(cfg.modo)) {
    throw new ErroConfig(
      `modo inválido: '${cfg.modo}' (esperado 'headless' ou 'acoplado')`,
    );
  }
  if (cfg.modo === 'acoplado' && !cfg.mcpToken) {
    throw new ErroConfig(
      "modo 'acoplado' exige o token da sessão: define DRIFT_MCP_TOKEN " +
        '(copia-o de Settings → Agent access no Drift; o token roda a cada sessão)',
    );
  }
  return cfg;
}

/* ------------------------------------------------------------------ */
/* Artefactos                                                         */
/* ------------------------------------------------------------------ */

/**
 * Normaliza um valor de porta artefacto para caminho absoluto.
 * Aceita: string (caminho), `{ id }` (convenção do núcleo — aqui o `id`
 * é o caminho absoluto do ficheiro), `{ caminho }` (tolerância).
 * Lança ErroConfig se não for resolvível ou o ficheiro não existir.
 */
function normalizarArtefacto(valor, nomePorta) {
  let candidato;
  if (typeof valor === 'string') {
    candidato = valor;
  } else if (valor && typeof valor === 'object') {
    candidato = valor.caminho ?? valor.path ?? valor.id;
  }
  if (typeof candidato !== 'string' || candidato.trim() === '') {
    throw new ErroConfig(
      `a porta '${nomePorta}' não traz um artefacto resolvível ` +
        `(esperado caminho em string ou { id } com o caminho do ficheiro)`,
    );
  }
  const caminho = isAbsolute(candidato) ? candidato : resolve(candidato);
  if (!existsSync(caminho)) {
    throw new ErroConfig(`a porta '${nomePorta}' aponta para ficheiro inexistente: ${caminho}`);
  }
  return caminho;
}

function normalizarListaArtefactos(valor, nomePorta) {
  if (valor === undefined || valor === null) {
    throw new ErroConfig(`a porta '${nomePorta}' não traz nenhum artefacto`);
  }
  const lista = Array.isArray(valor) ? valor : [valor];
  if (lista.length === 0) {
    throw new ErroConfig(`a porta '${nomePorta}' não traz nenhum artefacto`);
  }
  return lista.map((v, i) => normalizarArtefacto(v, `${nomePorta}[${i}]`));
}

/* ------------------------------------------------------------------ */
/* Cliente MCP (JSON-RPC 2.0 sobre POST /mcp)                         */
/* ------------------------------------------------------------------ */

/**
 * Cliente MCP mínimo para o Drift, sem dependências.
 *
 * Transporte: `POST http://127.0.0.1:<porta>/mcp` com
 * `Authorization: Bearer <token>`, corpo JSON-RPC 2.0:
 * `{ jsonrpc:"2.0", id, method:"tools/call",
 *    params:{ name:<ferramenta>, arguments:{...} } }`.
 * O resultado chega em `result.content[0].text` como JSON com o payload
 * da ferramenta (`{ ok, ... }` / `{ ok:false, error, detail }`).
 */
class ClienteMCP {
  #baseUrl;
  #token;
  #timeoutMs;
  #proximoId = 1;

  constructor({ baseUrl, token, timeoutMs }) {
    this.#baseUrl = baseUrl.replace(/\/+$/, '');
    this.#token = token;
    this.#timeoutMs = timeoutMs;
  }

  async #rpc(method, params) {
    const id = this.#proximoId++;
    const controlador = new AbortController();
    const limite = setTimeout(() => controlador.abort(), this.#timeoutMs);
    let resposta;
    try {
      resposta = await fetch(`${this.#baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...(this.#token ? { Authorization: `Bearer ${this.#token}` } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }),
        signal: controlador.signal,
      });
    } catch (erro) {
      throw new Error(
        `falha a contactar o MCP do Drift em ${this.#baseUrl}/mcp: ${erro?.message ?? erro}`,
      );
    } finally {
      clearTimeout(limite);
    }
    if (!resposta.ok) {
      throw new Error(`o MCP do Drift devolveu HTTP ${resposta.status} em /mcp`);
    }
    let envelope;
    try {
      envelope = await resposta.json();
    } catch {
      throw new Error('o MCP do Drift devolveu uma resposta que não é JSON');
    }
    if (envelope?.error) {
      throw new ErroConfig(
        `o MCP do Drift rejeitou a chamada '${method}': ` +
          `${envelope.error.message ?? JSON.stringify(envelope.error)} ` +
          `(incompatibilidade de protocolo — rever a versão do Drift)`,
      );
    }
    return envelope?.result;
  }

  /** Handshake MCP: devolve `{ serverInfo, instructions }`. */
  async inicializar() {
    const resultado = await this.#rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'wild-studio-drift-bridge', version: '0.1.0' },
    });
    // Notification: sem resposta esperada; ignora-se o corpo.
    try {
      await this.#rpc('notifications/initialized', {});
    } catch {
      // Alguns servidores não respondem a notificações — não é fatal.
    }
    // O resultado do initialize pode vir direto (MCP padrão) ou embrulhado
    // em `content` como as ferramentas — aceitam-se as duas formas.
    const conteudos = resultado?.content;
    const texto = Array.isArray(conteudos)
      ? conteudos.find((c) => c && typeof c.text === 'string')?.text
      : undefined;
    if (typeof texto === 'string') {
      try {
        return JSON.parse(texto);
      } catch {
        throw new Error('o handshake `initialize` devolveu texto que não é JSON');
      }
    }
    return resultado ?? {};
  }

  /** Chama uma ferramenta e devolve o payload já interpretado. */
  async ferramenta(nome, argumentos = {}) {
    const resultado = await this.#rpc('tools/call', {
      name: nome,
      arguments: argumentos,
    });
    const conteudos = resultado?.content;
    const texto = Array.isArray(conteudos)
      ? conteudos.find((c) => c && typeof c.text === 'string')?.text
      : undefined;
    if (typeof texto !== 'string') {
      throw new Error(
        `a ferramenta '${nome}' devolveu um resultado sem conteúdo de texto interpretável`,
      );
    }
    let payload;
    try {
      payload = JSON.parse(texto);
    } catch {
      throw new Error(`a ferramenta '${nome}' devolveu texto que não é JSON`);
    }
    if (payload && payload.ok === false) {
      throw new ErroDrift(payload.error ?? 'erro_desconhecido', payload.detail);
    }
    return payload ?? {};
  }

  catalogo(brief = true) {
    return this.ferramenta('catalog', { brief });
  }
  procurar(q, schema = false) {
    return this.ferramenta('search', schema ? { q, schema: true } : { q });
  }
  caixa(nomeOuOps) {
    return typeof nomeOuOps === 'string'
      ? this.ferramenta('toolbox', { name: nomeOuOps })
      : this.ferramenta('toolbox', { ops: nomeOuOps });
  }
  aplicar(ops) {
    return this.ferramenta('apply', { ops });
  }
  inspecionar(argumentos = {}) {
    return this.ferramenta('inspect', argumentos);
  }
}

/* ------------------------------------------------------------------ */
/* Versão do Drift                                                    */
/* ------------------------------------------------------------------ */

/** Extrai `{ major, minor }` de "0.7.5"; null se não for interpretável. */
function interpretarVersao(texto) {
  const m = typeof texto === 'string' ? texto.match(/(\d+)\.(\d+)(?:\.(\d+))?/) : null;
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3] ?? 0) };
}

/**
 * Valida a versão anunciada no handshake `initialize`.
 * Major diferente de 0 → ErroConfig (superfície revista). Versão
 * ilegível → aviso e continuação (documentado como limitação).
 */
function verificarVersao(serverInfo, versaoMinima) {
  const atual = interpretarVersao(serverInfo?.version);
  const minima = interpretarVersao(versaoMinima) ?? { major: 0, minor: 7 };
  if (!atual) {
    return {
      aviso:
        'o Drift não anunciou versão legível no handshake; a continuar ' +
        'sem verificação (ver README.md)',
    };
  }
  if (atual.major !== minima.major) {
    throw new ErroConfig(
      `versão do Drift incompatível: ${serverInfo.version} (major ${atual.major}); ` +
        `esta extensão foi revista para a major ${minima.major} — ` +
        'rever o mapeamento de operações antes de usar',
    );
  }
  if (atual.minor < minima.minor) {
    return {
      aviso:
        `o Drift ${serverInfo.version} é anterior à versão mínima ` +
        `${versaoMinima}; algumas operações podem não existir`,
    };
  }
  return {};
}

/* ------------------------------------------------------------------ */
/* Descoberta de operações                                            */
/* ------------------------------------------------------------------ */

/**
 * Candidatos por ação semântica (inglês, do mais provável ao menos).
 * Os cinco primeiros grupos são de confiança alta (documentados);
 * colocação/texto/legendas/transição são descobertos em runtime porque
 * a superfície do Drift v0.7.5 ainda evolui.
 */
const MAPA_OPS = {
  catalogo: ['catalog'],
  procurar: ['search'],
  caixa: ['toolbox'],
  aplicar: ['apply'],
  inspecionar: ['inspect'],
  importar: ['import_media'],
  exportar: ['export_video'],
  exportarComPreset: ['export_with_preset'],
  estadoExportacao: ['export_status'],
  colocarVideo: ['place_clip', 'add_clip', 'insert_clip', 'add_video_clip'],
  colocarAudio: ['place_audio_clip', 'add_audio_clip', 'add_audio'],
  legendas: ['import_subtitles', 'add_subtitles', 'apply_subtitles'],
  texto: ['add_text', 'add_title', 'add_text_clip'],
  transicao: ['add_transition'],
};

/** Ações opcionais: em falta, resolve-se a null (avisa-se e continua-se). */
const OPS_OPCIONAIS = new Set(['texto', 'transicao', 'exportarComPreset']);

/** Extrai nomes de operações de um payload de `catalog`/`search` tolerante a formas. */
function extrairNomesOps(payload) {
  const nomes = new Set();
  const visitar = (v) => {
    if (typeof v === 'string' && v.trim() !== '') {
      // Formas "nome — quando" do catalog brief: fica o nome.
      nomes.add(v.split('—')[0].split('-')[0].trim().split(/\s+/)[0]);
    } else if (Array.isArray(v)) {
      v.forEach(visitar);
    } else if (v && typeof v === 'object') {
      if (typeof v.name === 'string') nomes.add(v.name);
      if (typeof v.nome === 'string') nomes.add(v.nome);
      Object.values(v).forEach(visitar);
    }
  };
  visitar(payload?.tools ?? payload?.ferramentas ?? payload?.hits ?? payload);
  return nomes;
}

/**
 * Resolve cada ação semântica para um nome real de operação.
 * - `obrigatorias`: em falta → ErroConfig (falha explícita);
 * - `OPS_OPCIONAIS` em falta → null (avisa-se e continua-se);
 * - restantes ações não pedidas → undefined (ignoradas).
 */
function descobrirOps(nomesDisponiveis, obrigatorias) {
  const resolvidas = {};
  const emFalta = [];
  for (const [acao, candidatos] of Object.entries(MAPA_OPS)) {
    const encontrada = candidatos.find((c) => nomesDisponiveis.has(c));
    if (encontrada) {
      resolvidas[acao] = encontrada;
    } else if (obrigatorias.has(acao)) {
      emFalta.push(`${acao} (tentado: ${candidatos.join(', ')})`);
    } else if (OPS_OPCIONAIS.has(acao)) {
      resolvidas[acao] = null;
    }
  }
  if (emFalta.length > 0) {
    throw new ErroConfig(
      'operações essenciais do Drift não encontradas no catálogo desta versão: ' +
        emFalta.join('; ') +
        ' — rever o mapeamento de operações para esta versão do Drift',
    );
  }
  return resolvidas;
}

/** Escolhe, nas propriedades de um schema, a primeira chave que casa com os aliases. */
function escolherChave(propriedades, aliases) {
  if (!propriedades || typeof propriedades !== 'object') return undefined;
  for (const a of aliases) {
    if (Object.prototype.hasOwnProperty.call(propriedades, a)) return a;
  }
  // Tolerância: comparação insensível a maiúsculas.
  const minusculas = Object.fromEntries(
    Object.keys(propriedades).map((k) => [k.toLowerCase(), k]),
  );
  for (const a of aliases) {
    if (minusculas[a.toLowerCase()]) return minusculas[a.toLowerCase()];
  }
  return undefined;
}

/** Filtra args para as propriedades declaradas no schema da operação. */
function filtrarPorSchema(schema, args) {
  const props = schema?.properties;
  if (!props || typeof props !== 'object') return { ...args };
  const filtrados = {};
  for (const [k, v] of Object.entries(args)) {
    if (Object.prototype.hasOwnProperty.call(props, k)) filtrados[k] = v;
  }
  return filtrados;
}

/**
 * Mapeia campos semânticos de colocação para os nomes reais da operação,
 * usando o schema descoberto via `toolbox`.
 */
function mapearArgsColocacao(schema, { asset, faixa, inicio, duracao, texto }) {
  const props = schema?.properties ?? {};
  const args = {};
  const cAsset = escolherChave(props, ['asset', 'assetId', 'media', 'mediaId', 'clip', 'ficheiro', 'path', 'caminho']);
  const cFaixa = escolherChave(props, ['track', 'faixa', 'pista', 'lane']);
  const cInicio = escolherChave(props, ['start', 'inicio', 'in', 'position', 'tempo', 'at']);
  const cDuracao = escolherChave(props, ['duration', 'duracao', 'length', 'dur']);
  const cTexto = escolherChave(props, ['text', 'texto', 'title', 'titulo', 'content', 'conteudo']);
  if (cAsset) args[cAsset] = asset;
  if (cFaixa) args[cFaixa] = faixa;
  if (cInicio && inicio !== undefined) args[cInicio] = inicio;
  if (cDuracao && duracao !== undefined) args[cDuracao] = duracao;
  if (cTexto && texto !== undefined) args[cTexto] = texto;
  return filtrarPorSchema(schema, args);
}

/* ------------------------------------------------------------------ */
/* Lançamento do Drift                                                */
/* ------------------------------------------------------------------ */

/**
 * Lança `drift --headless --mcp-port <porta> [--mcp-token <token>]`.
 * Espera até o MCP responder ao `initialize` (poll) ou até ao timeout.
 * Devolve `{ cliente, terminar }`. Com `DRIFT_BRIDGE_SEM_LANCAR=1`
 * não lança nada (o servidor MCP já está a correr — útil em testes).
 */
async function lancarDrift(cfg) {
  const baseUrl = `http://127.0.0.1:${cfg.mcpPort}`;
  const token = cfg.mcpToken ?? `wild-studio-${Date.now().toString(36)}`;
  const cliente = new ClienteMCP({ baseUrl, token, timeoutMs: cfg.timeoutChamadaMs });

  if (cfg.semLancar) {
    return { cliente, terminar: async () => {} };
  }

  let processo;
  try {
    processo = spawn(cfg.driftPath, ['--headless', '--mcp-port', String(cfg.mcpPort), '--mcp-token', token], {
      stdio: 'ignore',
      detached: false,
    });
  } catch (erro) {
    throw new ErroConfig(
      `não foi possível lançar '${cfg.driftPath}': ${erro?.message ?? erro}`,
    );
  }
  const morte = new Promise((resolver) => {
    processo.once('error', (e) =>
      resolver(new ErroConfig(`o executável '${cfg.driftPath}' falhou ao arrancar: ${e.message}`)),
    );
    processo.once('exit', (codigo) => {
      if (codigo !== 0 && codigo !== null) {
        resolver(new ErroConfig(`o Drift terminou durante o arranque (código ${codigo})`));
      }
    });
  });
  let erroMorte = null;
  morte.then((e) => {
    erroMorte = e;
  });

  // Poll de prontidão: initialize até responder ou ao fim de ~30s.
  const inicio = Date.now();
  let ultimoErro = null;
  while (Date.now() - inicio < 30000) {
    if (erroMorte) throw erroMorte;
    try {
      await cliente.inicializar();
      ultimoErro = null;
      break;
    } catch (erro) {
      ultimoErro = erro;
      await dormirMs(1000);
    }
  }
  if (erroMorte) throw erroMorte;
  if (ultimoErro) {
    try {
      processo.kill('SIGTERM');
    } catch { /* já morreu */ }
    throw new ErroConfig(
      `o Drift não respondeu ao MCP em ${baseUrl} após o arranque: ${ultimoErro.message}`,
    );
  }

  return {
    cliente,
    terminar: async () => {
      try {
        processo.kill('SIGTERM');
      } catch { /* já terminou */ }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Validação do MP4                                                   */
/* ------------------------------------------------------------------ */

/** Validação básica: existe, não vazio e com assinatura `ftyp` de MP4. */
function validarMp4(caminho) {
  if (!existsSync(caminho)) {
    throw new ErroConfig(`a exportação não produziu ficheiro em ${caminho}`);
  }
  const st = statSync(caminho);
  if (st.size === 0) {
    throw new ErroConfig(`a exportação produziu um MP4 vazio em ${caminho}`);
  }
  const cabeca = readFileSync(caminho, null).subarray(0, 12);
  if (cabeca.length < 12 || cabeca.subarray(4, 8).toString('ascii') !== 'ftyp') {
    throw new ErroConfig(
      `o ficheiro exportado em ${caminho} não parece um MP4 válido (assinatura 'ftyp' em falta)`,
    );
  }
  return { caminho, tamanho: st.size };
}

/* ------------------------------------------------------------------ */
/* Mapeamento de erros do Drift → semântica do executor               */
/* ------------------------------------------------------------------ */

/**
 * Códigos determinísticos (config/versão/dados): falham sempre igual.
 * No protocolo v1 o executor ainda tenta até 3 vezes, mas cada tentativa
 * falha depressa na validação — o diagnóstico final é acionável.
 */
const CODIGOS_CONFIG = new Set([
  'bad_args',
  'type_mismatch',
  'unknown_op',
  'unknown_toolbox',
  'not_found',
  'import_failed',
  'unsupported',
  'consent_required',
]);

function mapearErroDrift(erro) {
  if (!(erro instanceof ErroDrift)) return erro; // transitório: o executor faz retry
  if (CODIGOS_CONFIG.has(erro.codigo)) {
    const dica =
      erro.codigo === 'unknown_op' || erro.codigo === 'unknown_toolbox'
        ? ' — a versão do Drift mudou a superfície MCP; rever o mapeamento de operações'
        : '';
    return new ErroConfig(`Drift devolveu '${erro.codigo}'${dica}: ${erro.message}`);
  }
  if (erro.codigo === 'export_failed') {
    return new ErroConfig(
      `a exportação falhou no Drift ('export_failed'): ${erro.message} ` +
        '(se mencionar renderização/OpenGL, o contexto gráfico não está disponível)',
    );
  }
  // export_busy, export_timeout, import_timeout, capture_failed, conflict…: transitórios.
  return erro;
}

/* ------------------------------------------------------------------ */
/* Fluxo principal                                                    */
/* ------------------------------------------------------------------ */

/**
 * Ponto de entrada da extensão (ver `runtime.exportacao` no manifesto).
 */
export async function executar(pedido) {
  const cfg = lerConfig(pedido);
  const entradas = pedido?.entradas ?? {};
  const avisos = [];

  // 1. Normalizar entradas (barato; falha depressa em dados inválidos).
  const narracao = entradas.narracao
    ? normalizarArtefacto(entradas.narracao, 'narracao')
    : null;
  const clips = normalizarListaArtefactos(entradas.clips, 'clips');
  const legendas = entradas.legendas ? normalizarArtefacto(entradas.legendas, 'legendas') : null;
  const titulo = lerTexto(entradas.titulo);
  const transicao = cfg.transicao !== 'nenhuma' ? cfg.transicao : null;
  const duracoes = cfg.duracoes ?? clips.map(() => cfg.duracaoCena);

  // 2. Lançar o Drift e fazer handshake.
  const { cliente, terminar } = await lancarDrift(cfg);
  try {
    const { serverInfo } = await cliente.inicializar();
    const ver = verificarVersao(serverInfo, cfg.versaoMinima);
    if (ver.aviso) avisos.push(ver.aviso);

    // 3. Descobrir operações no catálogo desta versão. Só se exige o que
    // o pedido realmente usa (ex.: sem legendas no pedido, a operação de
    // legendas não é obrigatória).
    const obrigatorias = new Set([
      'catalogo', 'procurar', 'caixa', 'aplicar', 'inspecionar',
      'importar', 'exportar', 'estadoExportacao', 'colocarVideo',
    ]);
    if (narracao) obrigatorias.add('colocarAudio');
    if (legendas) obrigatorias.add('legendas');
    const nomes = extrairNomesOps(await cliente.catalogo(true));
    let ops;
    try {
      ops = descobrirOps(nomes, obrigatorias);
    } catch (erro) {
      // Fallback: search por palavras-chave antes de desistir.
      const extra = extrairNomesOps(await cliente.procurar('clip'));
      ops = descobrirOps(new Set([...nomes, ...extra]), obrigatorias);
    }

    // Schemas das operações de colocação (para mapear argumentos com segurança).
    const schemas = {};
    for (const acao of ['colocarVideo', 'colocarAudio', 'legendas', 'texto', 'transicao']) {
      const nome = ops[acao];
      if (!nome) continue;
      try {
        const caixa = await cliente.caixa([nome]);
        schemas[acao] = caixa?.schemas?.[nome] ?? caixa?.[nome] ?? {};
      } catch {
        schemas[acao] = {};
      }
    }

    // 4. Importar assets (caminhos absolutos; confirmar missing:[] vazio).
    const importar = async (caminhos, rotulo) => {
      let resp;
      try {
        resp = await cliente.ferramenta(ops.importar, { paths: caminhos });
      } catch (erro) {
        throw mapearErroDrift(erro);
      }
      const emFalta = resp?.missing ?? [];
      if (Array.isArray(emFalta) && emFalta.length > 0) {
        throw new ErroConfig(`o Drift não encontrou estes ficheiros (${rotulo}): ${emFalta.join(', ')}`);
      }
      const importados = resp?.importados ?? resp?.imported ?? resp?.assets ?? [];
      return { importados, resposta: resp };
    };
    const idsImportados = new Map();
    const registaIds = (caminhos, importados) => {
      importados.forEach((it, i) => {
        const id = it?.id ?? it?.assetId ?? caminhos[i];
        idsImportados.set(caminhos[i], id);
      });
      caminhos.forEach((c) => {
        if (!idsImportados.has(c)) idsImportados.set(c, c);
      });
    };
    {
      const todos = [...clips];
      if (narracao) todos.push(narracao);
      if (legendas) todos.push(legendas);
      const { importados } = await importar(todos, 'assets do projeto');
      registaIds(todos, importados);
    }
    const idDe = (caminho) => idsImportados.get(caminho) ?? caminho;

    // 5. Montar a timeline em lotes (um undo-step por lote).
    const aplicarLote = async (operacoes, rotulo) => {
      try {
        return await cliente.aplicar(operacoes);
      } catch (erro) {
        const mapeado = mapearErroDrift(erro);
        if (mapeado instanceof ErroDrift) {
          throw new Error(
            `falha transitória a ${rotulo}: ${mapeado.message} (o executor volta a tentar do zero)`,
          );
        }
        throw mapeado;
      }
    };

    // 5a. Clips de vídeo em sequência na faixa 0.
    {
      const lote = [];
      let t = 0;
      clips.forEach((caminho, i) => {
        const dur = duracoes[i] ?? cfg.duracaoCena;
        lote.push({
          tool: ops.colocarVideo,
          args: mapearArgsColocacao(schemas.colocarVideo, {
            asset: idDe(caminho),
            faixa: 0,
            inicio: t,
            duracao: dur,
          }),
        });
        t += dur;
      });
      await aplicarLote(lote, 'colocar os clips de vídeo');
    }

    // 5b. Narração na faixa de áudio (faixa 1), do início.
    if (narracao) {
      await aplicarLote(
        [
          {
            tool: ops.colocarAudio,
            args: mapearArgsColocacao(schemas.colocarAudio, {
              asset: idDe(narracao),
              faixa: 1,
              inicio: 0,
            }),
          },
        ],
        'colocar a narração',
      );
    }

    // 5c. Legendas SRT (a operação já foi exigida na descoberta quando há legendas).
    if (legendas) {
      await aplicarLote(
        [
          {
            tool: ops.legendas,
            args: mapearArgsColocacao(schemas.legendas, {
              asset: idDe(legendas),
              faixa: 2,
            }),
          },
        ],
        'aplicar as legendas',
      );
    }

    // 5d. Título inicial (opcional: avisa e continua se a op não existir).
    if (titulo) {
      if (!ops.texto) {
        avisos.push('operação de texto não encontrada no catálogo; título inicial omitido');
      } else {
        await aplicarLote(
          [
            {
              tool: ops.texto,
              args: mapearArgsColocacao(schemas.texto, {
                asset: undefined,
                faixa: 3,
                inicio: 0,
                duracao: cfg.tituloDuracao,
                texto: titulo,
              }),
            },
          ],
          'adicionar o título',
        );
      }
    }

    // 5e. Transição entre cenas (opcional).
    if (transicao) {
      if (!ops.transicao) {
        avisos.push(`operação de transição não encontrada no catálogo; transição '${transicao}' omitida`);
      } else {
        const lote = [];
        for (let i = 0; i < clips.length - 1; i++) {
          const args = filtrarPorSchema(schemas.transicao, {
            transicao,
            transition: transicao,
            entre: [i, i + 1],
          });
          lote.push({ tool: ops.transicao, args });
        }
        if (lote.length > 0) await aplicarLote(lote, 'aplicar transições');
      }
    }

    // 6. Confirmar a montagem.
    const estado = await cliente.inspecionar({ clips: true }).catch(() => ({}));
    const nClips = Array.isArray(estado?.clips) ? estado.clips.length : undefined;
    if (nClips !== undefined && nClips < clips.length) {
      throw new Error(
        `a timeline ficou com ${nClips} clips, esperados pelo menos ${clips.length} — a repetir`,
      );
    }

    // 7. Exportar (assíncrono) com poll.
    const dirSaida = join(tmpdir(), 'wild-studio-drift-bridge', `projeto-${Date.now()}`);
    mkdirSync(dirSaida, { recursive: true });
    const caminhoMp4 = join(dirSaida, 'video_final.mp4');
    const argsExport = { path: caminhoMp4 };
    if (cfg.presetExportacao && ops.exportarComPreset) {
      argsExport.preset = cfg.presetExportacao;
    }
    let exp;
    try {
      exp = ops.exportarComPreset && cfg.presetExportacao
        ? await cliente.ferramenta(ops.exportarComPreset, argsExport)
        : await cliente.ferramenta(ops.exportar, argsExport);
    } catch (erro) {
      throw mapearErroDrift(erro);
    }
    const caminhoExportado = exp?.path ?? caminhoMp4;
    const inicioPoll = Date.now();
    for (;;) {
      let st;
      try {
        st = await cliente.ferramenta(ops.estadoExportacao, {});
      } catch (erro) {
        throw mapearErroDrift(erro);
      }
      const ativo = st?.active ?? st?.ativo ?? false;
      if (!ativo) {
        if (st?.ok === false || st?.error) {
          throw mapearErroDrift(new ErroDrift(st.error ?? 'export_failed', st.detail));
        }
        break;
      }
      if (Date.now() - inicioPoll > cfg.timeoutExportacaoMs) {
        throw new Error(
          `a exportação não concluiu em ${Math.round(cfg.timeoutExportacaoMs / 1000)}s (o executor volta a tentar)`,
        );
      }
      await dormirMs(cfg.intervaloPollMs);
    }

    // 8. Validar o MP4 e devolver a entrega.
    const info = validarMp4(caminhoExportado);
    if (avisos.length > 0) {
      // Os avisos vão para stderr para não poluir a resposta JSON da extensão.
      for (const a of avisos) console.error(`[drift-bridge] aviso: ${a}`);
    }
    return { saidas: { video_final: { id: info.caminho } } };
  } finally {
    await terminar();
  }
}

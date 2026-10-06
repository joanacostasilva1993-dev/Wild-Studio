// Licensed under the Business Source License 1.1 — see LICENSE

/**
 * Esquema SQLite do núcleo (M1 + registo de extensões do M2).
 *
 * Define o DDL de todas as tabelas do modelo de dados: canais, métodos
 * versionados, projetos com snapshot imutável, execuções, entregas,
 * artefactos, aprovações, tentativas, jobs persistidos, extensões
 * instaladas e capacidades declaradas.
 *
 * Convenções:
 * - Campos temporais em ISO 8601 (texto).
 * - JSON guardado em colunas TEXT (ordem de processos, definição de método,
 *   snapshot do projeto, portas de saída, valores de entrega).
 * - Tabelas de histórico (entregas, tentativas) são imutáveis por
 *   convenção: a camada de acesso não expõe UPDATE/DELETE sobre elas.
 */
export const DDL: string = `
CREATE TABLE IF NOT EXISTS canais (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  ordem_processos TEXT NOT NULL,
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metodos (
  id INTEGER PRIMARY KEY,
  canal_id INTEGER NOT NULL REFERENCES canais(id),
  processo TEXT NOT NULL,
  versao INTEGER NOT NULL,
  definicao TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  UNIQUE (canal_id, processo, versao)
);

CREATE TABLE IF NOT EXISTS projetos (
  id INTEGER PRIMARY KEY,
  canal_id INTEGER NOT NULL REFERENCES canais(id),
  nome TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'ativo',
  snapshot TEXT NOT NULL,
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS execucoes_processo (
  id INTEGER PRIMARY KEY,
  projeto_id INTEGER NOT NULL REFERENCES projetos(id),
  processo TEXT NOT NULL,
  ordem INTEGER NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendente'
);

CREATE TABLE IF NOT EXISTS execucoes_bloco (
  id INTEGER PRIMARY KEY,
  projeto_id INTEGER NOT NULL REFERENCES projetos(id),
  exec_processo_id INTEGER NOT NULL REFERENCES execucoes_processo(id),
  bloco_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  operador TEXT NOT NULL,
  titulo TEXT NOT NULL,
  saidas TEXT NOT NULL DEFAULT '[]',
  estado TEXT NOT NULL DEFAULT 'pendente',
  tentativa INTEGER NOT NULL DEFAULT 1,
  erro TEXT,
  UNIQUE (projeto_id, exec_processo_id, bloco_id)
);

CREATE TABLE IF NOT EXISTS entregas (
  id INTEGER PRIMARY KEY,
  exec_bloco_id INTEGER NOT NULL REFERENCES execucoes_bloco(id),
  projeto_id INTEGER NOT NULL REFERENCES projetos(id),
  tentativa INTEGER NOT NULL,
  tipo TEXT NOT NULL,
  valor TEXT NOT NULL,
  criada_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artefactos (
  id INTEGER PRIMARY KEY,
  entrega_id INTEGER NOT NULL REFERENCES entregas(id),
  caminho TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS aprovacoes (
  id INTEGER PRIMARY KEY,
  exec_bloco_id INTEGER NOT NULL REFERENCES execucoes_bloco(id),
  decisao TEXT NOT NULL,
  autor TEXT,
  comentario TEXT,
  criada_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tentativas (
  id INTEGER PRIMARY KEY,
  exec_bloco_id INTEGER NOT NULL REFERENCES execucoes_bloco(id),
  numero INTEGER NOT NULL,
  estado_antes TEXT NOT NULL,
  estado_depois TEXT NOT NULL,
  detalhe TEXT,
  criada_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY,
  exec_bloco_id INTEGER NOT NULL REFERENCES execucoes_bloco(id),
  operador TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendente',
  detalhe TEXT,
  criada_em TEXT NOT NULL
);

-- Protocolo de extensões (M2): registo de extensões instaladas e das
-- capacidades que cada uma declara (definição guardada como JSON).
CREATE TABLE IF NOT EXISTS extensoes (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  versao TEXT NOT NULL,
  autor TEXT NOT NULL,
  licenca TEXT NOT NULL,
  caminho TEXT NOT NULL,
  ativa INTEGER NOT NULL DEFAULT 0,
  nota_consentimento TEXT,
  instalada_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS capacidades (
  extensao_id TEXT NOT NULL REFERENCES extensoes(id),
  capacidade_id TEXT NOT NULL,
  definicao TEXT NOT NULL,
  PRIMARY KEY (extensao_id, capacidade_id)
);

CREATE INDEX IF NOT EXISTS idx_execucoes_bloco_projeto ON execucoes_bloco (projeto_id);
CREATE INDEX IF NOT EXISTS idx_execucoes_bloco_exec_processo ON execucoes_bloco (exec_processo_id);
CREATE INDEX IF NOT EXISTS idx_entregas_projeto ON entregas (projeto_id);
CREATE INDEX IF NOT EXISTS idx_tentativas_bloco ON tentativas (exec_bloco_id);
`;

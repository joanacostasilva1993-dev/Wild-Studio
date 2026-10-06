// Licensed under the Business Source License 1.1 — see LICENSE-DRAFT.md

/**
 * Peças partilhadas da UI: rótulos em Português Europeu, insígnias de
 * estado, alertas de erro e indicadores de carregamento.
 */

import type { BlocoTipo, EstadoExec, Operador, ProcessoId, ValueShape } from '../api.js';

/* ------------------------------ Rótulos --------------------------- */

export const NOMES_PROCESSOS: Record<ProcessoId, string> = {
  tema: 'Tema',
  titulo: 'Título',
  thumbnail: 'Thumbnail',
  guiao: 'Guião',
  narracao: 'Narração e Áudio',
  visuais: 'Assets Visuais',
  edicao: 'Edição',
  publicacao: 'Publicação',
};

export const ORDEM_PROCESSOS: ProcessoId[] = [
  'tema',
  'titulo',
  'thumbnail',
  'guiao',
  'narracao',
  'visuais',
  'edicao',
  'publicacao',
];

export const DESCRICOES_BLOCOS: Record<BlocoTipo, string> = {
  PESQUISAR: 'Obter material ou informação',
  ESCOLHER: 'Selecionar entre opções',
  CRIAR: 'Produzir conteúdo novo',
  VALIDAR: 'Aprovação humana explícita',
};

export const NOMES_ESTADOS: Record<EstadoExec, string> = {
  pendente: 'Pendente',
  em_curso: 'Em curso',
  aguardar_aprovacao: 'A aguardar aprovação',
  concluido: 'Concluído',
  falhou: 'Falhou',
  cancelado: 'Cancelado',
};

export const NOMES_OPERADORES: Record<Operador, string> = {
  humano: 'Humano',
  ia: 'IA',
  codigo: 'Código',
};

const FAMILIAS: Record<string, string> = {
  texto: 'texto',
  imagem: 'imagem',
  audio: 'áudio',
  video: 'vídeo',
};

/** Resumo legível de uma shape tipada (para as portas, só leitura). */
export function resumoShape(tipo: ValueShape): string {
  if (tipo.tipo === 'conteudo') {
    return `${FAMILIAS[tipo.familia] ?? tipo.familia} · ${tipo.cardinalidade} · ${tipo.representacao}`;
  }
  if (tipo.tipo === 'controlo') {
    const base = tipo.controlo;
    return tipo.controlo === 'selecao' && tipo.opcoes
      ? `${base} (${tipo.opcoes.join(' / ')})`
      : `${base} · ${tipo.cardinalidade}`;
  }
  return `registo (${tipo.campos.length} ${tipo.campos.length === 1 ? 'campo' : 'campos'}) · ${tipo.cardinalidade}`;
}

/** Trunca texto longo para resumos (entregas, mensagens). */
export function resumir(valor: unknown, limite = 120): string {
  const texto = typeof valor === 'string' ? valor : JSON.stringify(valor);
  if (texto.length <= limite) return texto;
  return `${texto.slice(0, limite)}…`;
}

/* --------------------------- Componentes -------------------------- */

export function InsigniaEstado({ estado }: { estado: EstadoExec }) {
  return <span className={`insignia estado-${estado}`}>{NOMES_ESTADOS[estado] ?? estado}</span>;
}

export function InsigniaTipo({ tipo }: { tipo: BlocoTipo }) {
  return (
    <span className={`insignia tipo-${tipo.toLowerCase()}`} title={DESCRICOES_BLOCOS[tipo]}>
      {tipo}
    </span>
  );
}

export function AlertaErro({ mensagem, aoFechar }: { mensagem: string; aoFechar?: () => void }) {
  return (
    <div className="alerta alerta-erro" role="alert">
      <span>{mensagem}</span>
      {aoFechar && (
        <button type="button" className="botao-limpo" onClick={aoFechar} aria-label="Fechar">
          ✕
        </button>
      )}
    </div>
  );
}

export function AlertaInfo({ mensagem }: { mensagem: string }) {
  return (
    <div className="alerta alerta-info" role="status">
      {mensagem}
    </div>
  );
}

export function ACarregar({ texto = 'A carregar…' }: { texto?: string }) {
  return <p className="a-carregar">{texto}</p>;
}

/* ---------------------------- Utilidades -------------------------- */

/**
 * Tenta interpretar texto como JSON. Devolve `{ ok: true, valor }` ou
 * `{ ok: false, erro }` com mensagem em pt-PT.
 */
export function interpretarJson(texto: string): { ok: true; valor: unknown } | { ok: false; erro: string } {
  const limpo = texto.trim();
  if (limpo === '') {
    return { ok: false, erro: 'O JSON está vazio.' };
  }
  try {
    return { ok: true, valor: JSON.parse(limpo) };
  } catch (e) {
    const detalhe = e instanceof Error ? e.message : String(e);
    return { ok: false, erro: `JSON inválido: ${detalhe}` };
  }
}

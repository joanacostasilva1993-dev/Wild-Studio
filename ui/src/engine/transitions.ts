// Licensed under the Business Source License 1.1 — see LICENSE

// Máquina de estados do motor de execução.
//
// Pura e determinista: `transitar` recebe o estado atual e uma intenção e
// devolve o estado seguinte — ou um erro descritivo quando a combinação não
// é válida. Nunca lança exceções e nunca toca em I/O.
//
// A tabela `TABELA` é a única fonte de verdade das transições (ver
// ESPECIFICACAO-MVP.md §5 e §6). Para a alterar, edita a tabela e ajusta os
// testes em `transitions.test.ts`, que cobrem as 54 combinações (6×9).

import type { EstadoExec } from '../db/index.js';

// Intenções que o motor (ou o utilizador, via API/UI) pode exprimir sobre
// um bloco de execução.
export type Intencao =
  | 'iniciar'
  | 'trabalho_concluido'
  | 'solicitar_aprovacao'
  | 'aprovar'
  | 'rejeitar'
  | 'repetir'
  | 'falhar'
  | 'cancelar'
  | 'retomar';

// Resultado de uma transição: ou o novo estado, ou um erro descritivo.
export type ResultadoTransicao = { estado: EstadoExec } | { erro: string };

// Tabela total e explícita: intenção → (estado atual → estado seguinte).
// Qualquer combinação ausente é inválida e devolve erro.
const TABELA: Record<Intencao, Partial<Record<EstadoExec, EstadoExec>>> = {
  iniciar: { pendente: 'em_curso' },
  trabalho_concluido: { em_curso: 'concluido' },
  solicitar_aprovacao: { em_curso: 'aguardar_aprovacao' },
  aprovar: { aguardar_aprovacao: 'concluido' },
  rejeitar: { aguardar_aprovacao: 'pendente' },
  repetir: { falhou: 'pendente' },
  falhar: { em_curso: 'falhou', aguardar_aprovacao: 'falhou' },
  cancelar: {
    pendente: 'cancelado',
    em_curso: 'cancelado',
    aguardar_aprovacao: 'cancelado',
    falhou: 'cancelado',
  },
  retomar: { cancelado: 'pendente', falhou: 'pendente' },
};

export function transitar(estado: EstadoExec, intencao: Intencao): ResultadoTransicao {
  const destino = TABELA[intencao]?.[estado];
  if (destino === undefined) {
    return {
      erro: `transição inválida: a intenção '${intencao}' não se aplica a um bloco em '${estado}'`,
    };
  }
  return { estado: destino };
}

// Licensed under the Business Source License 1.1 — see LICENSE

// Orquestração do motor de execução sobre o `Banco`.
//
// Regras do módulo:
// - Toda a transição de estado passa por `transitar` (transitions.ts); uma
//   combinação inválida nunca é aplicada ao banco.
// - Efeitos colaterais (tentativas, entregas, aprovações, jobs) são sempre
//   registados no banco antes/depois da mudança de estado.
// - Erros de validação de entregas lançam `Error` sem tocar no estado.
// - Tentativas falhadas de transição (intenção inválida para o estado)
//   lançam `Error` com a mensagem vinda de `transitar`.

import { transitar, type Intencao } from './transitions.js';
import { validarValor, type ValueShape } from '../contracts/index.js';
import type { Banco, ExecBlocoRow, ProjetoDetalhado } from '../db/index.js';

// Ações que `avancar` pode devolver.
export type AcaoAvanco = 'bloco_iniciado' | 'projeto_concluido' | 'aguarda_intervencao';

export interface ResultadoAvanco {
  acao: AcaoAvanco;
  execBloco?: ExecBlocoRow;
}

export interface OpcoesVeredito {
  autor?: string;
  comentario?: string;
}

export interface OpcoesRejeicao extends OpcoesVeredito {
  // Bloco (blocoId do método, não id de execução) para onde o fluxo volta
  // quando o VALIDAR é rejeitado. Tem de pertencer ao mesmo projeto.
  voltarParaBlocoId?: string;
}

// Cria um projeto a partir do canal indicado; delega no banco, que congela
// o snapshot do método no arranque (ver ESPECIFICACAO-MVP.md §5).
export function criarProjeto(banco: Banco, canalId: number, nome: string): ProjetoDetalhado {
  return banco.criarProjeto(canalId, nome);
}

// Faz a execução andar um passo: inicia o próximo bloco pendente, se for
// possível. No MVP corre um bloco de cada vez: enquanto houver um bloco em
// voo (em_curso, aguardar_aprovacao ou falhou), não se inicia outro.
export function avancar(banco: Banco, projetoId: number): ResultadoAvanco {
  const detalhe = banco.obterProjeto(projetoId);
  if (!detalhe) throw new Error(`projeto '${projetoId}' não encontrado`);

  if (detalhe.projeto.estado === 'concluido') return { acao: 'projeto_concluido' };
  if (detalhe.projeto.estado === 'cancelado') return { acao: 'aguarda_intervencao' };

  const blocos = detalhe.processos.flatMap((p) => p.blocos);
  const bloqueador = blocos.find(
    (b) => b.estado === 'em_curso' || b.estado === 'aguardar_aprovacao' || b.estado === 'falhou',
  );
  if (bloqueador) return { acao: 'aguarda_intervencao', execBloco: bloqueador };

  const proximo = banco.proximoBlocoPendente(projetoId);
  if (!proximo) {
    if (blocos.every((b) => b.estado === 'concluido')) {
      banco.marcarProjeto(projetoId, 'concluido');
      return { acao: 'projeto_concluido' };
    }
    return { acao: 'aguarda_intervencao' };
  }

  const arranque = transitar(proximo.estado, 'iniciar');
  if ('erro' in arranque) return { acao: 'aguarda_intervencao', execBloco: proximo };

  banco.definirEstadoBloco(proximo.id, arranque.estado);
  const tentativa = banco.incrementarTentativa(proximo.id);
  banco.registarTentativa(proximo.id, tentativa, proximo.estado, arranque.estado, 'arranque do bloco');

  if (proximo.tipo === 'VALIDAR') {
    // VALIDAR só existe com operador humano: pausa de imediato até haver
    // veredito explícito via aprovar()/rejeitar().
    const pausa = transitar(arranque.estado, 'solicitar_aprovacao');
    if ('erro' in pausa) throw new Error(pausa.erro); // impossível pela tabela; defesa
    banco.definirEstadoBloco(proximo.id, pausa.estado);
    banco.registarTentativa(proximo.id, tentativa, arranque.estado, pausa.estado, 'VALIDAR aguarda veredito humano');
  } else if (proximo.operador === 'ia' || proximo.operador === 'codigo') {
    // O job persistido é o ponto de delegação: se o processo morrer, o
    // trabalho retoma sem se perder. Sem executor real no M1, o bloco fica
    // em_curso com o job pendente.
    banco.criarJob(proximo.id, proximo.operador);
  }

  return { acao: 'bloco_iniciado', execBloco: refrescar(banco, proximo.id) };
}

// Submete a entrega de um bloco humano em curso. Valida o valor contra a
// primeira saída declarada do bloco (se o bloco não declarar saídas, aceita
// qualquer valor). Erros de validação lançam sem mudar o estado.
export function submeterEntrega(
  banco: Banco,
  execBlocoId: number,
  valor: unknown,
  autor?: string,
): ExecBlocoRow {
  const bloco = obterBloco(banco, execBlocoId);
  if (bloco.tipo === 'VALIDAR') {
    throw new Error(`o bloco '${bloco.blocoId}' é VALIDAR: só aceita veredito via aprovar()/rejeitar()`);
  }
  if (bloco.operador !== 'humano') {
    throw new Error(
      `o bloco '${bloco.blocoId}' é do operador '${bloco.operador}': entregas manuais só em blocos humanos`,
    );
  }
  if (bloco.estado !== 'em_curso') {
    throw new Error(
      `não é possível submeter entrega: o bloco '${bloco.blocoId}' está em '${bloco.estado}' (esperado 'em_curso')`,
    );
  }

  const saidas = bloco.saidas ?? [];
  if (saidas.length > 0) {
    const erros = validarValor(saidas[0].tipo, valor);
    if (!Array.isArray(erros)) {
      // A forma declarada não é uma shape reconhecível: não há como validar.
      throw new Error(
        `não foi possível validar a entrega: a saída declarada do bloco '${bloco.blocoId}' tem forma inválida`,
      );
    }
    if (erros.length > 0) {
      throw new Error(`entrega inválida para o bloco '${bloco.blocoId}': ${erros.join('; ')}`);
    }
  }

  const detalheTentativa = autor ? `entrega submetida por ${autor}` : 'entrega submetida';
  banco.registarTentativa(bloco.id, bloco.tentativa, bloco.estado, 'concluido', detalheTentativa);
  // A linhagem da entrega guarda a saída declarada (tipo) e o valor.
  banco.registarEntrega(bloco.id, bloco.projetoId, bloco.tentativa, saidas[0] ?? null, valor);
  return mudarEstado(banco, bloco, 'trabalho_concluido', { detalhe: detalheTentativa });
}

// Conclui um bloco automático (operador 'ia'/'codigo') com as entregas
// produzidas pela extensão. É o par automático de `submeterEntrega` — que
// é só para humanos — e o ponto onde o executor de jobs (M2) regista o
// trabalho feito pela extensão.
//
// Cada item casa por ordem com a saída declarada correspondente: `itens[i]`
// é validado contra `saidas[i]`. Se o número de itens for diferente do número
// de saídas declaradas, lança. Qualquer erro de validação lança sem tocar no
// estado do bloco (nem entregas, nem transição, nem tentativa).
export function concluirEntregaAutomatica(
  banco: Banco,
  execBlocoId: number,
  itens: { tipo: unknown; valor: unknown }[],
): ExecBlocoRow {
  const bloco = obterBloco(banco, execBlocoId);
  if (bloco.tipo === 'VALIDAR') {
    throw new Error(`o bloco '${bloco.blocoId}' é VALIDAR: só aceita veredito via aprovar()/rejeitar()`);
  }
  if (bloco.operador !== 'ia' && bloco.operador !== 'codigo') {
    throw new Error(
      `o bloco '${bloco.blocoId}' é do operador '${bloco.operador}': entrega automática só em blocos 'ia'/'codigo'`,
    );
  }
  if (bloco.estado !== 'em_curso') {
    throw new Error(
      `não é possível concluir entrega automática: o bloco '${bloco.blocoId}' está em '${bloco.estado}' (esperado 'em_curso')`,
    );
  }

  const saidas = bloco.saidas ?? [];
  if (itens.length !== saidas.length) {
    throw new Error(
      `a extensão devolveu ${itens.length} entrega(s) mas o bloco '${bloco.blocoId}' declara ${saidas.length} saída(s)`,
    );
  }

  // Valida todos os itens antes de escrever qualquer coisa: um único item
  // inválido aborta sem tocar no estado.
  itens.forEach((item, indice) => {
    const declarada: unknown = saidas[indice];
    const porta = typeof declarada === 'object' && declarada !== null ? declarada as {
      chave?: unknown;
      tipo?: unknown;
    } : null;
    const chave = typeof porta?.chave === 'string' ? porta.chave : `#${indice + 1}`;
    const forma = porta?.tipo;
    if (typeof forma !== 'object' || forma === null) {
      throw new Error(
        `não foi possível validar a entrega '${chave}': a saída declarada do bloco '${bloco.blocoId}' tem forma inválida`,
      );
    }
    const erros = validarValor(forma as ValueShape, item.valor, chave);
    if (!Array.isArray(erros)) {
      // A shape tem discriminador irreconhecível: não há como validar.
      throw new Error(
        `não foi possível validar a entrega '${chave}': a saída declarada do bloco '${bloco.blocoId}' tem forma inválida`,
      );
    }
    if (erros.length > 0) {
      throw new Error(`entrega inválida para o bloco '${bloco.blocoId}': ${erros.join('; ')}`);
    }
  });

  const detalhe = `entrega automática da extensão (${itens.length} saída(s))`;
  itens.forEach((item, indice) => {
    // A linhagem regista o tipo declarado pela extensão (o contrato contra o
    // qual a resposta foi validada); se a extensão não o declarar, regista a
    // saída declarada no método.
    banco.registarEntrega(bloco.id, bloco.projetoId, bloco.tentativa, item.tipo ?? saidas[indice] ?? null, item.valor);
  });
  banco.registarTentativa(bloco.id, bloco.tentativa, bloco.estado, 'concluido', detalhe);
  return mudarEstado(banco, bloco, 'trabalho_concluido', { detalhe });
}

// Aprova um bloco VALIDAR que aguarda veredito.
export function aprovar(banco: Banco, execBlocoId: number, opcoes: OpcoesVeredito = {}): ExecBlocoRow {
  const bloco = obterBloco(banco, execBlocoId);
  if (bloco.estado !== 'aguardar_aprovacao') {
    throw new Error(
      `não é possível aprovar: o bloco '${bloco.blocoId}' está em '${bloco.estado}' (esperado 'aguardar_aprovacao')`,
    );
  }
  banco.registarAprovacao(bloco.id, 'aprovado', opcoes.autor, opcoes.comentario);
  return mudarEstado(banco, bloco, 'aprovar', { detalhe: detalheVeredito('aprovado', opcoes) });
}

// Rejeita um bloco VALIDAR que aguarda veredito. O VALIDAR volta a pendente
// para nova ronda; com `voltarParaBlocoId`, o bloco indicado (do mesmo
// projeto) também volta a pendente, com tentativa+1.
export function rejeitar(banco: Banco, execBlocoId: number, opcoes: OpcoesRejeicao = {}): ExecBlocoRow {
  const bloco = obterBloco(banco, execBlocoId);
  if (bloco.estado !== 'aguardar_aprovacao') {
    throw new Error(
      `não é possível rejeitar: o bloco '${bloco.blocoId}' está em '${bloco.estado}' (esperado 'aguardar_aprovacao')`,
    );
  }
  banco.registarAprovacao(bloco.id, 'rejeitado', opcoes.autor, opcoes.comentario);
  const resultado = mudarEstado(banco, bloco, 'rejeitar', { detalhe: detalheVeredito('rejeitado', opcoes) });

  if (opcoes.voltarParaBlocoId && opcoes.voltarParaBlocoId !== bloco.blocoId) {
    const anterior = banco.obterExecBlocoPorBlocoId(bloco.projetoId, opcoes.voltarParaBlocoId);
    if (!anterior) {
      throw new Error(`bloco '${opcoes.voltarParaBlocoId}' não encontrado no projeto '${bloco.projetoId}'`);
    }
    // Reabertura administrativa: um bloco já concluído não tem saída na
    // tabela de transições, por isso volta a pendente por reposição direta,
    // com tentativa+1 para a nova ronda. As entregas antigas mantêm-se —
    // são imutáveis; a correção gera novas entregas.
    const novaTentativa = banco.incrementarTentativa(anterior.id);
    banco.definirEstadoBloco(anterior.id, 'pendente');
    banco.registarTentativa(
      anterior.id,
      novaTentativa,
      anterior.estado,
      'pendente',
      `rejeição no VALIDAR '${bloco.blocoId}': fluxo devolvido`,
    );
  }

  return resultado;
}

// Volta a pôr um bloco falhado em pendente, com tentativa+1.
export function repetir(banco: Banco, execBlocoId: number): ExecBlocoRow {
  const bloco = obterBloco(banco, execBlocoId);
  return mudarEstado(banco, bloco, 'repetir', { incrementar: true, detalhe: 'repetição pedida' });
}

// Regista o erro e leva o bloco a falhou.
export function falhar(banco: Banco, execBlocoId: number, erro: string): ExecBlocoRow {
  const bloco = obterBloco(banco, execBlocoId);
  return mudarEstado(banco, bloco, 'falhar', { erro, detalhe: erro });
}

export function cancelar(banco: Banco, execBlocoId: number): ExecBlocoRow {
  const bloco = obterBloco(banco, execBlocoId);
  return mudarEstado(banco, bloco, 'cancelar', { detalhe: 'cancelado' });
}

// Retoma um bloco cancelado ou falhado: volta a pendente com tentativa+1.
export function retomar(banco: Banco, execBlocoId: number): ExecBlocoRow {
  const bloco = obterBloco(banco, execBlocoId);
  return mudarEstado(banco, bloco, 'retomar', { incrementar: true, detalhe: 'retomado' });
}

// Fotografia atual do projeto (processos, blocos, estados).
export function estadoProjeto(banco: Banco, projetoId: number): ProjetoDetalhado {
  const detalhe = banco.obterProjeto(projetoId);
  if (!detalhe) throw new Error(`projeto '${projetoId}' não encontrado`);
  return detalhe;
}

// ---- auxiliares internos ----

function obterBloco(banco: Banco, execBlocoId: number): ExecBlocoRow {
  const bloco = banco.obterExecBloco(execBlocoId);
  if (!bloco) throw new Error(`bloco de execução '${execBlocoId}' não encontrado`);
  return bloco;
}

function refrescar(banco: Banco, execBlocoId: number): ExecBlocoRow {
  const bloco = banco.obterExecBloco(execBlocoId);
  if (!bloco) throw new Error(`bloco de execução '${execBlocoId}' desapareceu do banco`);
  return bloco;
}

interface OpcoesMudanca {
  incrementar?: boolean;
  erro?: string;
  detalhe?: string;
}

// Aplica uma intenção ao bloco passando sempre por `transitar`: intenção
// inválida para o estado lança Error e nada é escrito no banco.
function mudarEstado(banco: Banco, bloco: ExecBlocoRow, intencao: Intencao, opcoes: OpcoesMudanca = {}): ExecBlocoRow {
  const resultado = transitar(bloco.estado, intencao);
  if ('erro' in resultado) throw new Error(resultado.erro);
  const tentativa = opcoes.incrementar ? banco.incrementarTentativa(bloco.id) : bloco.tentativa;
  // Ao sair de 'falhou', o erro que causou a falha é limpo: a nova ronda
  // começa sem diagnóstico obsoleto (o histórico fica em `tentativas`).
  const erro = bloco.estado === 'falhou' ? (opcoes.erro ?? null) : opcoes.erro;
  banco.definirEstadoBloco(bloco.id, resultado.estado, erro);
  banco.registarTentativa(bloco.id, tentativa, bloco.estado, resultado.estado, opcoes.detalhe);
  return refrescar(banco, bloco.id);
}

function detalheVeredito(decisao: 'aprovado' | 'rejeitado', opcoes: OpcoesVeredito): string {
  const partes = [`veredito: ${decisao}`];
  if (opcoes.autor) partes.push(`por ${opcoes.autor}`);
  if (opcoes.comentario) partes.push(`— ${opcoes.comentario}`);
  return partes.join(' ');
}

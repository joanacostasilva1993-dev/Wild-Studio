// Licensed under the Business Source License 1.1 — see LICENSE-DRAFT.md

/**
 * Vista de entregas: lista as entregas de um projeto (tipo, bloco de
 * origem, resumo do valor).
 */

import { useEffect, useState } from 'react';
import { entregasProjeto, listarProjetos, type Entrega, type Projeto } from '../api.js';
import { ACarregar, AlertaErro, AlertaInfo, resumir } from './partes.js';

/** Resumo legível do tipo de uma entrega (pode ser uma shape ou uma porta). */
function resumoTipo(tipo: unknown): string {
  if (tipo === null || tipo === undefined) return '—';
  if (typeof tipo !== 'object') return String(tipo);
  const t = tipo as Record<string, unknown>;
  // A entrega guarda a porta completa { chave, tipo: <shape>, obrigatoria }.
  const shape = t.tipo !== null && typeof t.tipo === 'object' && !Array.isArray(t.tipo) ? (t.tipo as Record<string, unknown>) : t;
  if (typeof shape.tipo === 'string' && typeof shape.familia === 'string') {
    return `${shape.familia} · ${String(shape.cardinalidade ?? '?')} · ${String(shape.representacao ?? '?')}`;
  }
  if (typeof shape.tipo === 'string' && typeof shape.controlo === 'string') {
    return `controlo · ${shape.controlo}`;
  }
  if (shape.tipo === 'registo' && Array.isArray(shape.campos)) {
    return `registo (${shape.campos.length} ${shape.campos.length === 1 ? 'campo' : 'campos'})`;
  }
  return resumir(tipo, 80);
}

export function VistaEntregas({
  projetoId,
  aoEscolherProjeto,
}: {
  projetoId: number | null;
  aoEscolherProjeto: (id: number | null) => void;
}) {
  const [projetos, setProjetos] = useState<Projeto[] | null>(null);
  const [entregas, setEntregas] = useState<Entrega[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    listarProjetos()
      .then(setProjetos)
      .catch((e: unknown) => setErro(e instanceof Error ? e.message : 'Falha ao listar os projetos.'));
  }, []);

  useEffect(() => {
    if (projetoId === null) {
      setEntregas(null);
      return;
    }
    setEntregas(null);
    entregasProjeto(projetoId)
      .then(setEntregas)
      .catch((e: unknown) => setErro(e instanceof Error ? e.message : 'Falha ao listar as entregas.'));
  }, [projetoId]);

  return (
    <section>
      <div className="cabecalho-vista">
        <h2>Entregas</h2>
        <label className="campo campo-em-linha">
          Projeto
          <select
            value={projetoId === null ? '' : String(projetoId)}
            onChange={(e) => aoEscolherProjeto(e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="">— escolhe um projeto —</option>
            {(projetos ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>
      </div>

      {erro && <AlertaErro mensagem={erro} />}
      {projetoId === null ? (
        <AlertaInfo mensagem="Escolhe um projeto para veres as entregas produzidas pelos blocos." />
      ) : entregas === null ? (
        <ACarregar />
      ) : entregas.length === 0 ? (
        <AlertaInfo mensagem="Ainda não há entregas neste projeto." />
      ) : (
        <ul className="lista-entregas">
          {entregas.map((entrega) => (
            <li key={entrega.id} className="cartao">
              <div className="cabecalho-cartao">
                <strong>Entrega #{entrega.id}</strong>
                <span className="texto-fraco">{new Date(entrega.criadaEm).toLocaleString('pt-PT')}</span>
              </div>
              <dl className="definicoes">
                <dt>Tipo</dt>
                <dd>
                  <code>{resumoTipo(entrega.tipo)}</code>
                </dd>
                <dt>Bloco de origem</dt>
                <dd>execução #{entrega.execBlocoId} · tentativa {entrega.tentativa}</dd>
                <dt>Valor</dt>
                <dd>
                  <pre className="valor-entrega">{resumir(entrega.valor, 500)}</pre>
                </dd>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

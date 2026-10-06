// Licensed under the Business Source License 1.1 — see LICENSE-DRAFT.md

/**
 * Vista de canais: listar, criar (com a ordem dos 8 processos) e ver o
 * detalhe de um canal — os 8 processos com o método de cada um.
 */

import { useEffect, useState } from 'react';
import {
  criarCanal,
  listarCanais,
  obterCanal,
  type Canal,
  type CanalDetalhado,
  type ProcessoId,
} from '../api.js';
import { ACarregar, AlertaErro, AlertaInfo, InsigniaTipo, NOMES_PROCESSOS, ORDEM_PROCESSOS } from './partes.js';

export type IrPara = (vista: 'metodo', canalId: number, processo: ProcessoId) => void;

/* ------------------------- Criação de canal ----------------------- */

function FormCriarCanal({ aoCriar }: { aoCriar: (canal: Canal) => void }) {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [ordem, setOrdem] = useState<ProcessoId[]>([...ORDEM_PROCESSOS]);
  const [erro, setErro] = useState<string | null>(null);
  const [aGuardar, setAGuardar] = useState(false);

  function mover(indice: number, direcao: -1 | 1) {
    const novoIndice = indice + direcao;
    if (novoIndice < 0 || novoIndice >= ordem.length) return;
    const copia = [...ordem];
    [copia[indice], copia[novoIndice]] = [copia[novoIndice], copia[indice]];
    setOrdem(copia);
  }

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (nome.trim() === '') {
      setErro('O nome do canal não pode estar vazio.');
      return;
    }
    setAGuardar(true);
    try {
      const canal = await criarCanal(nome.trim(), ordem);
      setNome('');
      setOrdem([...ORDEM_PROCESSOS]);
      setAberto(false);
      aoCriar(canal);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao criar o canal.');
    } finally {
      setAGuardar(false);
    }
  }

  if (!aberto) {
    return (
      <button type="button" className="botao primario" onClick={() => setAberto(true)}>
        + Novo canal
      </button>
    );
  }

  return (
    <form className="cartao" onSubmit={submeter}>
      <h3>Novo canal</h3>
      {erro && <AlertaErro mensagem={erro} aoFechar={() => setErro(null)} />}
      <label className="campo">
        Nome
        <input
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex.: Canal de tecnologia"
          autoFocus
        />
      </label>
      <fieldset className="campo">
        <legend>Ordem dos processos</legend>
        <ol className="lista-ordenada">
          {ordem.map((processo, i) => (
            <li key={processo}>
              <span>
                {i + 1}. {NOMES_PROCESSOS[processo]}
              </span>
              <span className="acoes-linha">
                <button type="button" className="botao pequeno" disabled={i === 0} onClick={() => mover(i, -1)} aria-label="Subir">
                  ↑
                </button>
                <button
                  type="button"
                  className="botao pequeno"
                  disabled={i === ordem.length - 1}
                  onClick={() => mover(i, 1)}
                  aria-label="Descer"
                >
                  ↓
                </button>
              </span>
            </li>
          ))}
        </ol>
      </fieldset>
      <div className="acoes-linha">
        <button type="submit" className="botao primario" disabled={aGuardar}>
          {aGuardar ? 'A criar…' : 'Criar canal'}
        </button>
        <button type="button" className="botao" onClick={() => setAberto(false)}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

/* ---------------------------- Lista ------------------------------- */

export function ListaCanais({ aoAbrir }: { aoAbrir: (id: number) => void }) {
  const [canais, setCanais] = useState<Canal[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    try {
      setCanais(await listarCanais());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao listar os canais.');
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

  if (erro) return <AlertaErro mensagem={erro} />;
  if (canais === null) return <ACarregar />;

  return (
    <section>
      <div className="cabecalho-vista">
        <h2>Canais</h2>
        <FormCriarCanal aoCriar={() => void carregar()} />
      </div>
      {canais.length === 0 ? (
        <AlertaInfo mensagem="Ainda não há canais. Cria o primeiro para começares a desenhar métodos." />
      ) : (
        <ul className="grelha-cartoes">
          {canais.map((canal) => (
            <li key={canal.id} className="cartao clicavel" onClick={() => aoAbrir(canal.id)}>
              <h3>{canal.nome}</h3>
              <p className="texto-fraco">Canal #{canal.id}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* --------------------------- Detalhe ------------------------------ */

export function DetalheCanal({ canalId, irParaMetodo }: { canalId: number; irParaMetodo: IrPara }) {
  const [canal, setCanal] = useState<CanalDetalhado | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    obterCanal(canalId)
      .then((c) => {
        if (ativo) setCanal(c);
      })
      .catch((e: unknown) => {
        if (ativo) setErro(e instanceof Error ? e.message : 'Falha ao obter o canal.');
      });
    return () => {
      ativo = false;
    };
  }, [canalId]);

  if (erro) return <AlertaErro mensagem={erro} />;
  if (canal === null) return <ACarregar />;

  return (
    <section>
      <div className="cabecalho-vista">
        <h2>{canal.nome}</h2>
      </div>
      <p className="texto-fraco">
        Ordem dos processos: {canal.ordemProcessos.map((p) => NOMES_PROCESSOS[p]).join(' → ')}
      </p>
      <div className="lista-processos">
        {canal.ordemProcessos.map((processo) => {
          const metodo = canal.metodos[processo];
          return (
            <article key={processo} className="cartao">
              <div className="cabecalho-cartao">
                <h3>{NOMES_PROCESSOS[processo]}</h3>
                <button
                  type="button"
                  className="botao pequeno"
                  onClick={() => irParaMetodo('metodo', canal.id, processo)}
                >
                  {metodo ? 'Editar método' : 'Definir método'}
                </button>
              </div>
              {!metodo ? (
                <p className="texto-fraco">Sem método definido para este processo.</p>
              ) : (
                <>
                  <p className="texto-fraco">
                    Versão {metodo.versao} · {metodo.definicao.blocos.length}{' '}
                    {metodo.definicao.blocos.length === 1 ? 'bloco' : 'blocos'}
                  </p>
                  <ol className="lista-blocos">
                    {metodo.definicao.blocos.map((bloco) => (
                      <li key={bloco.id}>
                        <InsigniaTipo tipo={bloco.tipo} />
                        <span className="titulo-bloco">{bloco.titulo}</span>
                        <span className="texto-fraco">· {bloco.operador}</span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

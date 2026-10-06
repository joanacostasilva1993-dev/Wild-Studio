// Licensed under the Business Source License 1.1 — see LICENSE-DRAFT.md

/**
 * Vista de extensões: listar (nome, versão, ativa/inativa), instalar a
 * partir de um caminho local, dar ou revogar consentimento (ativar/
 * desativar), ver o detalhe e remover.
 */

import { useEffect, useState } from 'react';
import {
  consentirExtensao,
  instalarExtensao,
  listarExtensoes,
  obterExtensao,
  removerExtensao,
  type ExtensaoDetalhada,
  type ExtensaoResumo,
} from '../api.js';
import { ACarregar, AlertaErro, AlertaInfo, resumir } from './partes.js';

function FormInstalar({ aoInstalar }: { aoInstalar: () => void }) {
  const [caminho, setCaminho] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [aInstalar, setAInstalar] = useState(false);
  const [resumo, setResumo] = useState<string | null>(null);

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setResumo(null);
    if (caminho.trim() === '') {
      setErro('Indica o caminho local da extensão.');
      return;
    }
    setAInstalar(true);
    try {
      const resultado = await instalarExtensao(caminho.trim());
      setResumo(
        `Extensão '${resultado.nome}' (${resultado.versao}) instalada. ` +
          'Arranca inativa: revê o resumo abaixo e dá consentimento para a ativar.',
      );
      setCaminho('');
      aoInstalar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao instalar a extensão.');
    } finally {
      setAInstalar(false);
    }
  }

  return (
    <form className="cartao" onSubmit={submeter}>
      <h3>Instalar extensão</h3>
      <p className="texto-fraco">
        Indica o caminho local do pacote (pasta com o ficheiro <code>extensao.json</code>), relativo ao
        diretório de trabalho do servidor. A extensão arranca <strong>inativa</strong>.
      </p>
      {erro && <AlertaErro mensagem={erro} aoFechar={() => setErro(null)} />}
      {resumo && <AlertaInfo mensagem={resumo} />}
      <label className="campo">
        Caminho local
        <input
          type="text"
          value={caminho}
          onChange={(e) => setCaminho(e.target.value)}
          placeholder="Ex.: ./extensions/wild-studio.titulos-referencia"
          spellCheck={false}
        />
      </label>
      <button type="submit" className="botao primario" disabled={aInstalar}>
        {aInstalar ? 'A instalar…' : 'Instalar'}
      </button>
    </form>
  );
}

function DetalheExtensao({ id, aoFechar }: { id: string; aoFechar: () => void }) {
  const [extensao, setExtensao] = useState<ExtensaoDetalhada | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    obterExtensao(id)
      .then((e) => {
        if (ativo) setExtensao(e);
      })
      .catch((e: unknown) => {
        if (ativo) setErro(e instanceof Error ? e.message : 'Falha ao obter a extensão.');
      });
    return () => {
      ativo = false;
    };
  }, [id]);

  return (
    <div className="cartao detalhe-extensao">
      <div className="cabecalho-cartao">
        <h3>Detalhe da extensão</h3>
        <button type="button" className="botao pequeno" onClick={aoFechar}>
          Fechar
        </button>
      </div>
      {erro && <AlertaErro mensagem={erro} />}
      {!extensao && !erro && <ACarregar />}
      {extensao && (
        <dl className="definicoes">
          <dt>Nome</dt>
          <dd>{extensao.nome}</dd>
          <dt>Versão</dt>
          <dd>{extensao.versao}</dd>
          <dt>Autor</dt>
          <dd>{extensao.autor || '—'}</dd>
          <dt>Licença</dt>
          <dd>{extensao.licenca || '—'}</dd>
          <dt>Caminho</dt>
          <dd>
            <code>{extensao.caminho}</code>
          </dd>
          <dt>Instalada em</dt>
          <dd>{extensao.instaladaEm ? new Date(extensao.instaladaEm).toLocaleString('pt-PT') : '—'}</dd>
          {extensao.notaConsentimento && (
            <>
              <dt>Nota de consentimento</dt>
              <dd>{extensao.notaConsentimento}</dd>
            </>
          )}
          <dt>Capacidades</dt>
          <dd>
            {extensao.capacidades.length === 0 ? (
              'Nenhuma.'
            ) : (
              <ul className="lista-capacidades">
                {extensao.capacidades.map((cap, i) => (
                  <li key={i}>
                    <code>{String(cap.operador ?? '?')}</code> · blocos:{' '}
                    {Array.isArray(cap.blocos) && cap.blocos.length > 0 ? cap.blocos.join(', ') : '—'} ·
                    processos:{' '}
                    {Array.isArray(cap.processos) && cap.processos.length > 0 ? cap.processos.join(', ') : '—'}
                    {Array.isArray(cap.efeitos) && cap.efeitos.length > 0 && (
                      <>
                        <br />
                        Efeitos: {cap.efeitos.join(', ')}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </dl>
      )}
    </div>
  );
}

export function VistaExtensoes() {
  const [extensoes, setExtensoes] = useState<ExtensaoResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [nota, setNota] = useState<Record<string, string>>({});
  const [indisponivel, setIndisponivel] = useState(false);

  async function carregar() {
    try {
      setExtensoes(await listarExtensoes());
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : 'Falha ao listar as extensões.';
      if (/indisponível/i.test(mensagem)) {
        setIndisponivel(true);
      } else {
        setErro(mensagem);
      }
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

  async function mudarConsentimento(extensao: ExtensaoResumo, consentido: boolean) {
    setErro(null);
    try {
      await consentirExtensao(extensao.id, consentido, nota[extensao.id]?.trim() || undefined);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao atualizar o consentimento.');
    }
  }

  async function remover(extensao: ExtensaoResumo) {
    if (!window.confirm(`Remover a extensão '${extensao.nome}'?`)) return;
    setErro(null);
    try {
      await removerExtensao(extensao.id);
      if (detalheId === extensao.id) setDetalheId(null);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao remover a extensão.');
    }
  }

  if (indisponivel) {
    return (
      <section>
        <h2>Extensões</h2>
        <AlertaInfo mensagem="O registo de extensões está indisponível (o módulo do motor ainda não foi entregue nesta instância)." />
      </section>
    );
  }

  return (
    <section>
      <div className="cabecalho-vista">
        <h2>Extensões</h2>
      </div>
      {erro && <AlertaErro mensagem={erro} aoFechar={() => setErro(null)} />}

      <FormInstalar aoInstalar={() => void carregar()} />

      {extensoes === null ? (
        <ACarregar />
      ) : extensoes.length === 0 ? (
        <AlertaInfo mensagem="Nenhuma extensão instalada." />
      ) : (
        <ul className="lista-extensoes">
          {extensoes.map((extensao) => (
            <li key={extensao.id} className="cartao">
              <div className="cabecalho-cartao">
                <div>
                  <h3>{extensao.nome}</h3>
                  <p className="texto-fraco">
                    <code>{extensao.id}</code> · versão {extensao.versao} · {extensao.capacidades}{' '}
                    {extensao.capacidades === 1 ? 'capacidade' : 'capacidades'}
                  </p>
                </div>
                <span className={`insignia ${extensao.ativa ? 'ativa' : 'inativa'}`}>
                  {extensao.ativa ? 'Ativa' : 'Inativa'}
                </span>
              </div>
              <label className="campo">
                Nota de consentimento (opcional)
                <input
                  type="text"
                  value={nota[extensao.id] ?? ''}
                  onChange={(e) => setNota((n) => ({ ...n, [extensao.id]: e.target.value }))}
                  placeholder="Ex.: aprovada após revisão do manifesto"
                />
              </label>
              <div className="acoes-linha">
                {extensao.ativa ? (
                  <button
                    type="button"
                    className="botao pequeno"
                    onClick={() => void mudarConsentimento(extensao, false)}
                  >
                    Desativar
                  </button>
                ) : (
                  <button
                    type="button"
                    className="botao pequeno primario"
                    onClick={() => void mudarConsentimento(extensao, true)}
                  >
                    Consentir e ativar
                  </button>
                )}
                <button type="button" className="botao pequeno" onClick={() => setDetalheId(extensao.id)}>
                  Detalhe
                </button>
                <button type="button" className="botao pequeno perigo" onClick={() => void remover(extensao)}>
                  Remover
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {detalheId && <DetalheExtensao id={detalheId} aoFechar={() => setDetalheId(null)} />}
    </section>
  );
}

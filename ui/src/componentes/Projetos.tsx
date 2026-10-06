// Licensed under the Business Source License 1.1 — see LICENSE-DRAFT.md

/**
 * Vista de projetos: listar, criar (a escolher o canal) e o detalhe de
 * execução — blocos por processo com estado, botão Avançar, botões
 * Aprovar/Rejeitar nos VALIDAR a aguardar aprovação, formulário de entrega
 * nos blocos humanos pendentes e botão "Executar jobs" para os automáticos.
 */

import { useEffect, useState } from 'react';
import {
  aprovarBloco,
  avancarProjeto,
  criarProjeto,
  executarJobs,
  jobsPendentes,
  listarCanais,
  listarProjetos,
  obterProjeto,
  rejeitarBloco,
  repetirJob,
  submeterEntrega,
  type Canal,
  type ExecBloco,
  type JobPendente,
  type Projeto,
  type ProjetoDetalhado,
  type ResultadoAvanco,
  type ResumoExecucaoJobs,
} from '../api.js';
import {
  ACarregar,
  AlertaErro,
  AlertaInfo,
  InsigniaEstado,
  InsigniaTipo,
  NOMES_PROCESSOS,
  interpretarJson,
  resumir,
} from './partes.js';

/* ------------------------- Criação de projeto --------------------- */

function FormCriarProjeto({ aoCriar }: { aoCriar: (projeto: { id: number }) => void }) {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [canais, setCanais] = useState<Canal[] | null>(null);
  const [canalId, setCanalId] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [aGuardar, setAGuardar] = useState(false);

  useEffect(() => {
    if (aberto && canais === null) {
      listarCanais()
        .then(setCanais)
        .catch((e: unknown) => setErro(e instanceof Error ? e.message : 'Falha ao listar os canais.'));
    }
  }, [aberto, canais]);

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (nome.trim() === '') {
      setErro('O nome do projeto não pode estar vazio.');
      return;
    }
    const idCanal = Number(canalId);
    if (!Number.isInteger(idCanal) || idCanal <= 0) {
      setErro('Escolhe um canal para o projeto.');
      return;
    }
    setAGuardar(true);
    try {
      const projeto = await criarProjeto(idCanal, nome.trim());
      setNome('');
      setCanalId('');
      setAberto(false);
      aoCriar(projeto);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao criar o projeto.');
    } finally {
      setAGuardar(false);
    }
  }

  if (!aberto) {
    return (
      <button type="button" className="botao primario" onClick={() => setAberto(true)}>
        + Novo projeto
      </button>
    );
  }

  return (
    <form className="cartao" onSubmit={submeter}>
      <h3>Novo projeto</h3>
      {erro && <AlertaErro mensagem={erro} aoFechar={() => setErro(null)} />}
      <label className="campo">
        Nome
        <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Vídeo sobre jardins" autoFocus />
      </label>
      <label className="campo">
        Canal
        <select value={canalId} onChange={(e) => setCanalId(e.target.value)}>
          <option value="">— escolhe um canal —</option>
          {(canais ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      </label>
      <div className="acoes-linha">
        <button type="submit" className="botao primario" disabled={aGuardar}>
          {aGuardar ? 'A criar…' : 'Criar projeto'}
        </button>
        <button type="button" className="botao" onClick={() => setAberto(false)}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

/* ------------------------------- Lista ---------------------------- */

export function ListaProjetos({
  aoAbrir,
  aoVerEntregas,
}: {
  aoAbrir: (id: number) => void;
  aoVerEntregas: (id: number) => void;
}) {
  const [projetos, setProjetos] = useState<Projeto[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    try {
      setProjetos(await listarProjetos());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao listar os projetos.');
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

  if (erro) return <AlertaErro mensagem={erro} />;
  if (projetos === null) return <ACarregar />;

  return (
    <section>
      <div className="cabecalho-vista">
        <h2>Projetos</h2>
        <FormCriarProjeto aoCriar={() => void carregar()} />
      </div>
      {projetos.length === 0 ? (
        <AlertaInfo mensagem="Ainda não há projetos. Cria o primeiro a partir de um canal." />
      ) : (
        <ul className="grelha-cartoes">
          {projetos.map((projeto) => (
            <li key={projeto.id} className="cartao">
              <h3>{projeto.nome}</h3>
              <p className="texto-fraco">Projeto #{projeto.id}</p>
              <div className="acoes-linha">
                <button type="button" className="botao pequeno primario" onClick={() => aoAbrir(projeto.id)}>
                  Abrir
                </button>
                <button type="button" className="botao pequeno" onClick={() => aoVerEntregas(projeto.id)}>
                  Ver entregas
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* --------------------- Entrega de bloco humano -------------------- */

function FormEntrega({
  bloco,
  aoSubmeter,
}: {
  bloco: ExecBloco;
  aoSubmeter: (execBlocoId: number, valor: unknown, autor: string) => Promise<void>;
}) {
  const [texto, setTexto] = useState('');
  const [autor, setAutor] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [aEnviar, setAEnviar] = useState(false);

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    const resultado = interpretarJson(texto);
    if (!resultado.ok) {
      setErro(resultado.erro);
      return;
    }
    setErro(null);
    setAEnviar(true);
    try {
      await aoSubmeter(bloco.id, resultado.valor, autor.trim());
      setTexto('');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao submeter a entrega.');
    } finally {
      setAEnviar(false);
    }
  }

  return (
    <form className="form-entrega" onSubmit={submeter}>
      <h5>Submeter entrega</h5>
      <label className="campo">
        Valor (JSON)
        <textarea
          rows={3}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder='Ex.: "O meu texto" ou {"titulo": "…"}'
          spellCheck={false}
        />
      </label>
      <div className="grelha-2">
        <label className="campo">
          Autor (opcional)
          <input type="text" value={autor} onChange={(e) => setAutor(e.target.value)} />
        </label>
        <div className="campo alinhar-fim">
          <button type="submit" className="botao pequeno primario" disabled={aEnviar}>
            {aEnviar ? 'A enviar…' : 'Submeter'}
          </button>
        </div>
      </div>
      {erro && <AlertaErro mensagem={erro} aoFechar={() => setErro(null)} />}
    </form>
  );
}

/* --------------------- Veredito (aprovar/rejeitar) ----------------- */

function FormVeredito({
  bloco,
  blocosAnteriores,
  aoVeredito,
}: {
  bloco: ExecBloco;
  blocosAnteriores: ExecBloco[];
  aoVeredito: (
    execBlocoId: number,
    decisao: 'aprovar' | 'rejeitar',
    autor: string,
    comentario: string,
    voltarParaBlocoId?: string,
  ) => Promise<void>;
}) {
  const [autor, setAutor] = useState('');
  const [comentario, setComentario] = useState('');
  const [voltarPara, setVoltarPara] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [aEnviar, setAEnviar] = useState(false);

  async function enviar(decisao: 'aprovar' | 'rejeitar') {
    setErro(null);
    setAEnviar(true);
    try {
      await aoVeredito(bloco.id, decisao, autor.trim(), comentario.trim(), voltarPara || undefined);
      setComentario('');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao registar o veredito.');
    } finally {
      setAEnviar(false);
    }
  }

  return (
    <div className="form-veredito">
      <h5>Veredito</h5>
      <div className="grelha-2">
        <label className="campo">
          Autor (opcional)
          <input type="text" value={autor} onChange={(e) => setAutor(e.target.value)} />
        </label>
        <label className="campo">
          Comentário (opcional)
          <input type="text" value={comentario} onChange={(e) => setComentario(e.target.value)} />
        </label>
      </div>
      <label className="campo">
        Em caso de rejeição, voltar para (opcional)
        <select value={voltarPara} onChange={(e) => setVoltarPara(e.target.value)}>
          <option value="">— comportamento predefinido —</option>
          {blocosAnteriores.map((b) => (
            <option key={b.blocoId} value={b.blocoId}>
              {b.titulo}
            </option>
          ))}
        </select>
      </label>
      <div className="acoes-linha">
        <button type="button" className="botao pequeno sucesso" disabled={aEnviar} onClick={() => void enviar('aprovar')}>
          Aprovar
        </button>
        <button type="button" className="botao pequeno perigo" disabled={aEnviar} onClick={() => void enviar('rejeitar')}>
          Rejeitar
        </button>
      </div>
      {erro && <AlertaErro mensagem={erro} aoFechar={() => setErro(null)} />}
    </div>
  );
}

/* ------------------------------- Jobs ----------------------------- */

function textoAcaoAvanco(resultado: ResultadoAvanco): string {
  switch (resultado.acao) {
    case 'bloco_iniciado':
      return resultado.execBloco
        ? `Bloco iniciado: ${resultado.execBloco.titulo}.`
        : 'Bloco iniciado.';
    case 'projeto_concluido':
      return 'Projeto concluído.';
    case 'aguarda_intervencao':
      return resultado.execBloco
        ? `A aguardar intervenção: ${resultado.execBloco.titulo} (${resultado.execBloco.estado}).`
        : 'A aguardar intervenção.';
    default:
      return `Ação: ${resultado.acao}.`;
  }
}

function PainelJobs({
  projetoId,
  aoMudanca,
}: {
  projetoId: number;
  aoMudanca: () => void;
}) {
  const [jobs, setJobs] = useState<JobPendente[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [resumo, setResumo] = useState<ResumoExecucaoJobs | null>(null);
  const [aExecutar, setAExecutar] = useState(false);

  async function carregar() {
    try {
      const todos = await jobsPendentes();
      setJobs(todos.filter((j) => j.projetoId === projetoId));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao listar os jobs.');
    }
  }

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projetoId]);

  async function executar() {
    setErro(null);
    setResumo(null);
    setAExecutar(true);
    try {
      const r = await executarJobs();
      setResumo(r);
      await carregar();
      aoMudanca();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao executar os jobs.');
    } finally {
      setAExecutar(false);
    }
  }

  async function repetir(id: number) {
    setErro(null);
    try {
      await repetirJob(id);
      await carregar();
      aoMudanca();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao repetir o job.');
    }
  }

  return (
    <section className="cartao">
      <div className="cabecalho-cartao">
        <h3>Jobs automáticos</h3>
        <button type="button" className="botao pequeno primario" onClick={() => void executar()} disabled={aExecutar}>
          {aExecutar ? 'A executar…' : 'Executar jobs'}
        </button>
      </div>
      {erro && <AlertaErro mensagem={erro} aoFechar={() => setErro(null)} />}
      {resumo && (
        <AlertaInfo
          mensagem={`Executados: ${resumo.executados} · concluídos: ${resumo.concluidos} · falhados: ${resumo.falhados} · adiados: ${resumo.adiados}.`}
        />
      )}
      {jobs === null ? (
        <ACarregar texto="A carregar jobs…" />
      ) : jobs.length === 0 ? (
        <p className="texto-fraco">Sem jobs pendentes para este projeto.</p>
      ) : (
        <ul className="lista-blocos">
          {jobs.map((job) => (
            <li key={job.id}>
              <span className="titulo-bloco">#{job.id} — {job.bloco.titulo}</span>
              <span className="texto-fraco">
                {' '}· {job.operador} · tentativa {job.tentativasJob}
                {job.bloco.extensaoId ? ` · ${job.bloco.extensaoId}` : ''}
              </span>
              <button type="button" className="botao pequeno" onClick={() => void repetir(job.id)}>
                Repetir
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------ Detalhe --------------------------- */

export function DetalheProjeto({ projetoId }: { projetoId: number }) {
  const [detalhe, setDetalhe] = useState<ProjetoDetalhado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [aAvancar, setAAvancar] = useState(false);

  async function carregar() {
    try {
      setDetalhe(await obterProjeto(projetoId));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao obter o projeto.');
    }
  }

  useEffect(() => {
    let ativo = true;
    obterProjeto(projetoId)
      .then((d) => {
        if (ativo) setDetalhe(d);
      })
      .catch((e: unknown) => {
        if (ativo) setErro(e instanceof Error ? e.message : 'Falha ao obter o projeto.');
      });
    return () => {
      ativo = false;
    };
  }, [projetoId]);

  async function avancar() {
    setErro(null);
    setInfo(null);
    setAAvancar(true);
    try {
      const resultado = await avancarProjeto(projetoId);
      setInfo(textoAcaoAvanco(resultado));
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao avançar o projeto.');
    } finally {
      setAAvancar(false);
    }
  }

  async function submeter(execBlocoId: number, valor: unknown, autor: string) {
    await submeterEntrega(execBlocoId, valor, autor);
    setInfo('Entrega submetida.');
    await carregar();
  }

  async function veredito(
    execBlocoId: number,
    decisao: 'aprovar' | 'rejeitar',
    autor: string,
    comentario: string,
    voltarParaBlocoId?: string,
  ) {
    if (decisao === 'aprovar') {
      await aprovarBloco(execBlocoId, autor, comentario);
      setInfo('Bloco aprovado.');
    } else {
      await rejeitarBloco(execBlocoId, autor, comentario, voltarParaBlocoId);
      setInfo('Bloco rejeitado.');
    }
    await carregar();
  }

  if (erro) return <AlertaErro mensagem={erro} />;
  if (detalhe === null) return <ACarregar />;

  const { projeto, processos } = detalhe;
  const concluido = projeto.estado === 'concluido';

  return (
    <section>
      <div className="cabecalho-vista">
        <div>
          <h2>{projeto.nome}</h2>
          <p className="texto-fraco">
            Projeto #{projeto.id} · estado: {projeto.estado}
          </p>
        </div>
        {!concluido && (
          <button type="button" className="botao primario" onClick={() => void avancar()} disabled={aAvancar}>
            {aAvancar ? 'A avançar…' : 'Avançar'}
          </button>
        )}
      </div>

      {info && <AlertaInfo mensagem={info} />}

      <PainelJobs projetoId={projetoId} aoMudanca={() => void carregar()} />

      <div className="lista-processos">
        {processos.map((proc) => (
          <article key={proc.id} className="cartao">
            <div className="cabecalho-cartao">
              <h3>{NOMES_PROCESSOS[proc.processo] ?? proc.processo}</h3>
              <InsigniaEstado estado={proc.estado} />
            </div>
            <div className="blocos-execucao">
              {proc.blocos.map((bloco) => {
                const anteriores = proc.blocos.filter(
                  (b) => b.blocoId !== bloco.blocoId && b.id < bloco.id,
                );
                const mostraEntrega =
                  bloco.operador === 'humano' &&
                  (bloco.estado === 'pendente' || bloco.estado === 'em_curso');
                const mostraVeredito =
                  bloco.tipo === 'VALIDAR' && bloco.estado === 'aguardar_aprovacao';
                return (
                  <div key={bloco.id} className={`bloco-execucao estado-${bloco.estado}`}>
                    <div className="cabecalho-cartao">
                      <span>
                        <InsigniaTipo tipo={bloco.tipo} />{' '}
                        <strong>{bloco.titulo}</strong>
                      </span>
                      <InsigniaEstado estado={bloco.estado} />
                    </div>
                    <p className="texto-fraco detalhe-bloco">
                      Operador: {bloco.operador}
                      {bloco.extensaoId ? ` · extensão: ${bloco.extensaoId}` : ''}
                      {' '}· tentativa {bloco.tentativa}
                    </p>
                    {bloco.erro && <p className="erro-bloco">Erro: {resumir(bloco.erro, 300)}</p>}
                    {mostraEntrega && <FormEntrega bloco={bloco} aoSubmeter={submeter} />}
                    {mostraVeredito && (
                      <FormVeredito bloco={bloco} blocosAnteriores={anteriores} aoVeredito={veredito} />
                    )}
                  </div>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

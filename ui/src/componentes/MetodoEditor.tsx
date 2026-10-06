// Licensed under the Business Source License 1.1 — see LICENSE-DRAFT.md

/**
 * Editor de método (por processo): listar blocos (tipo, operador, título),
 * adicionar/remover/reordenar, escolher operador, ver portas de
 * entrada/saída (só leitura) e editar `parametros` como JSON validado.
 * Guarda via `PUT /api/canais/:id/metodos`.
 */

import { useEffect, useState } from 'react';
import {
  guardarMetodo,
  obterCanal,
  type BlocoDef,
  type BlocoTipo,
  type Operador,
  type ProcessoId,
} from '../api.js';
import {
  ACarregar,
  AlertaErro,
  AlertaInfo,
  InsigniaTipo,
  NOMES_OPERADORES,
  NOMES_PROCESSOS,
  interpretarJson,
  resumoShape,
} from './partes.js';

const TIPOS_BLOCO: BlocoTipo[] = ['PESQUISAR', 'ESCOLHER', 'CRIAR', 'VALIDAR'];
const OPERADORES: Operador[] = ['humano', 'ia', 'codigo'];

function blocoVazio(): BlocoDef {
  return {
    id: `bloco-${Date.now().toString(36)}`,
    tipo: 'CRIAR',
    operador: 'humano',
    titulo: 'Novo bloco',
    entradas: [],
    saidas: [],
  };
}

function clonar(bloco: BlocoDef): BlocoDef {
  return JSON.parse(JSON.stringify(bloco)) as BlocoDef;
}

/** Validação local antes de enviar (a do servidor é a fonte de verdade). */
function validarBlocos(blocos: BlocoDef[]): string[] {
  const erros: string[] = [];
  const vistos = new Set<string>();
  blocos.forEach((bloco, i) => {
    const onde = `Bloco ${i + 1}`;
    if (bloco.id.trim() === '') erros.push(`${onde}: o id não pode estar vazio.`);
    else if (vistos.has(bloco.id)) erros.push(`${onde}: id duplicado ('${bloco.id}').`);
    vistos.add(bloco.id);
    if (bloco.titulo.trim() === '') erros.push(`${onde}: o título não pode estar vazio.`);
    if (bloco.tipo === 'VALIDAR' && bloco.operador !== 'humano') {
      erros.push(`${onde}: VALIDAR só aceita o operador humano.`);
    }
    if ((bloco.operador === 'ia' || bloco.operador === 'codigo') && !bloco.extensaoId?.trim()) {
      erros.push(`${onde}: o operador ${bloco.operador} exige um extensaoId.`);
    }
  });
  return erros;
}

interface EditorBlocoProps {
  bloco: BlocoDef;
  indice: number;
  total: number;
  aoAlterar: (indice: number, bloco: BlocoDef) => void;
  aoRemover: (indice: number) => void;
  aoMover: (indice: number, direcao: -1 | 1) => void;
}

function EditorBloco({ bloco, indice, total, aoAlterar, aoRemover, aoMover }: EditorBlocoProps) {
  const [expandido, setExpandido] = useState(false);
  const [parametrosTexto, setParametrosTexto] = useState(
    bloco.parametros === undefined ? '' : JSON.stringify(bloco.parametros, null, 2),
  );
  const [erroParametros, setErroParametros] = useState<string | null>(null);

  function atualizar(parcial: Partial<BlocoDef>) {
    aoAlterar(indice, { ...bloco, ...parcial });
  }

  function alterarTipo(tipo: BlocoTipo) {
    // VALIDAR só aceita operador humano: força a correção.
    const operador: Operador = tipo === 'VALIDAR' ? 'humano' : bloco.operador;
    atualizar({ tipo, operador });
  }

  function alterarOperador(operador: Operador) {
    // Limpa o extensaoId ao voltar para humano.
    const extensaoId = operador === 'humano' ? undefined : bloco.extensaoId;
    atualizar({ operador, extensaoId });
  }

  function confirmarParametros() {
    if (parametrosTexto.trim() === '') {
      setErroParametros(null);
      atualizar({ parametros: undefined });
      return;
    }
    const resultado = interpretarJson(parametrosTexto);
    if (!resultado.ok) {
      setErroParametros(resultado.erro);
      return;
    }
    if (typeof resultado.valor !== 'object' || resultado.valor === null || Array.isArray(resultado.valor)) {
      setErroParametros('Os parâmetros têm de ser um objeto JSON (ex.: {"tema": "…"}).');
      return;
    }
    setErroParametros(null);
    atualizar({ parametros: resultado.valor as Record<string, unknown> });
  }

  const precisaExtensao = bloco.operador === 'ia' || bloco.operador === 'codigo';

  return (
    <article className="cartao bloco-editor">
      <div className="cabecalho-cartao">
        <button type="button" className="botao-limpo cabecalho-expandivel" onClick={() => setExpandido(!expandido)}>
          <InsigniaTipo tipo={bloco.tipo} />
          <span className="titulo-bloco">{bloco.titulo || '(sem título)'}</span>
          <span className="texto-fraco">· {NOMES_OPERADORES[bloco.operador]}</span>
          <span className="texto-fraco">{expandido ? '▾' : '▸'}</span>
        </button>
        <span className="acoes-linha">
          <button type="button" className="botao pequeno" disabled={indice === 0} onClick={() => aoMover(indice, -1)} aria-label="Subir">
            ↑
          </button>
          <button
            type="button"
            className="botao pequeno"
            disabled={indice === total - 1}
            onClick={() => aoMover(indice, 1)}
            aria-label="Descer"
          >
            ↓
          </button>
          <button type="button" className="botao pequeno perigo" onClick={() => aoRemover(indice)}>
            Remover
          </button>
        </span>
      </div>

      {expandido && (
        <div className="corpo-editor">
          <div className="grelha-2">
            <label className="campo">
              Identificador
              <input
                type="text"
                value={bloco.id}
                onChange={(e) => atualizar({ id: e.target.value })}
                placeholder="Ex.: escolher-titulo"
              />
            </label>
            <label className="campo">
              Título
              <input
                type="text"
                value={bloco.titulo}
                onChange={(e) => atualizar({ titulo: e.target.value })}
                placeholder="Ex.: Escolher o título do vídeo"
              />
            </label>
            <label className="campo">
              Tipo de bloco
              <select value={bloco.tipo} onChange={(e) => alterarTipo(e.target.value as BlocoTipo)}>
                {TIPOS_BLOCO.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              Operador
              <select
                value={bloco.operador}
                onChange={(e) => alterarOperador(e.target.value as Operador)}
                disabled={bloco.tipo === 'VALIDAR'}
                title={bloco.tipo === 'VALIDAR' ? 'VALIDAR só aceita operador humano.' : undefined}
              >
                {OPERADORES.map((o) => (
                  <option key={o} value={o}>
                    {NOMES_OPERADORES[o]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {precisaExtensao && (
            <label className="campo">
              Identificador da extensão (extensaoId)
              <input
                type="text"
                value={bloco.extensaoId ?? ''}
                onChange={(e) => atualizar({ extensaoId: e.target.value || undefined })}
                placeholder="Ex.: wild-studio.titulos-referencia"
              />
            </label>
          )}

          <label className="campo">
            Descrição
            <input
              type="text"
              value={bloco.descricao ?? ''}
              onChange={(e) => atualizar({ descricao: e.target.value || undefined })}
              placeholder="Opcional"
            />
          </label>

          <div className="portas">
            <div>
              <h4>Entradas</h4>
              {bloco.entradas.length === 0 ? (
                <p className="texto-fraco">Nenhuma.</p>
              ) : (
                <ul className="lista-portas">
                  {bloco.entradas.map((porta) => (
                    <li key={porta.chave}>
                      <code>{porta.chave}</code> — {resumoShape(porta.tipo)}
                      {porta.obrigatoria ? '' : ' (opcional)'}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h4>Saídas</h4>
              {bloco.saidas.length === 0 ? (
                <p className="texto-fraco">Nenhuma.</p>
              ) : (
                <ul className="lista-portas">
                  {bloco.saidas.map((porta) => (
                    <li key={porta.chave}>
                      <code>{porta.chave}</code> — {resumoShape(porta.tipo)}
                      {porta.obrigatoria ? '' : ' (opcional)'}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="texto-fraco nota-portas">
              As portas são só de leitura aqui: vêm da definição guardada (extensões declaram-nas no manifesto).
            </p>
          </div>

          <label className="campo">
            Parâmetros (JSON)
            <textarea
              rows={4}
              value={parametrosTexto}
              onChange={(e) => setParametrosTexto(e.target.value)}
              onBlur={confirmarParametros}
              placeholder='{"tema": "o meu próximo vídeo"}'
              spellCheck={false}
            />
          </label>
          {erroParametros && <AlertaErro mensagem={erroParametros} aoFechar={() => setErroParametros(null)} />}
        </div>
      )}
    </article>
  );
}

/* ------------------------- Editor de método ----------------------- */

export function EditorMetodo({ canalId, processo }: { canalId: number; processo: ProcessoId }) {
  const [nomeCanal, setNomeCanal] = useState('');
  const [versao, setVersao] = useState<number | null>(null);
  const [blocos, setBlocos] = useState<BlocoDef[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [errosValidacao, setErrosValidacao] = useState<string[]>([]);
  const [aGuardar, setAGuardar] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    obterCanal(canalId)
      .then((canal) => {
        if (!ativo) return;
        setNomeCanal(canal.nome);
        const metodo = canal.metodos[processo];
        if (metodo) {
          setVersao(metodo.versao);
          setBlocos(metodo.definicao.blocos.map(clonar));
        } else {
          setVersao(null);
          setBlocos([]);
        }
      })
      .catch((e: unknown) => {
        if (ativo) setErro(e instanceof Error ? e.message : 'Falha ao obter o método.');
      });
    return () => {
      ativo = false;
    };
  }, [canalId, processo]);

  function alterarBloco(indice: number, bloco: BlocoDef) {
    setBlocos((atual) => (atual ? atual.map((b, i) => (i === indice ? bloco : b)) : atual));
    setMensagem(null);
  }

  function removerBloco(indice: number) {
    setBlocos((atual) => (atual ? atual.filter((_, i) => i !== indice) : atual));
    setMensagem(null);
  }

  function moverBloco(indice: number, direcao: -1 | 1) {
    setBlocos((atual) => {
      if (!atual) return atual;
      const novoIndice = indice + direcao;
      if (novoIndice < 0 || novoIndice >= atual.length) return atual;
      const copia = [...atual];
      [copia[indice], copia[novoIndice]] = [copia[novoIndice], copia[indice]];
      return copia;
    });
    setMensagem(null);
  }

  async function guardar() {
    if (!blocos) return;
    setErro(null);
    setErrosValidacao([]);
    setMensagem(null);
    if (blocos.length === 0) {
      setErrosValidacao(['O método tem de ter pelo menos um bloco.']);
      return;
    }
    const locais = validarBlocos(blocos);
    if (locais.length > 0) {
      setErrosValidacao(locais);
      return;
    }
    setAGuardar(true);
    try {
      const resultado = await guardarMetodo(canalId, { processo, blocos });
      setVersao(resultado.versao);
      setMensagem(`Método guardado (versão ${resultado.versao}).`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao guardar o método.');
    } finally {
      setAGuardar(false);
    }
  }

  if (erro) return <AlertaErro mensagem={erro} />;
  if (blocos === null) return <ACarregar />;

  return (
    <section>
      <div className="cabecalho-vista">
        <div>
          <h2>
            Método · {NOMES_PROCESSOS[processo]}
          </h2>
          <p className="texto-fraco">
            Canal: {nomeCanal} · {versao === null ? 'ainda sem versão guardada' : `versão ${versao}`}
          </p>
        </div>
        <button type="button" className="botao primario" onClick={() => void guardar()} disabled={aGuardar}>
          {aGuardar ? 'A guardar…' : 'Guardar método'}
        </button>
      </div>

      {mensagem && <AlertaInfo mensagem={mensagem} />}
      {errosValidacao.length > 0 && (
        <div className="alerta alerta-erro" role="alert">
          <ul>
            {errosValidacao.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {blocos.length === 0 ? (
        <AlertaInfo mensagem="Este processo ainda não tem blocos. Adiciona o primeiro abaixo." />
      ) : (
        <div className="lista-blocos-editor">
          {blocos.map((bloco, i) => (
            <EditorBloco
              key={bloco.id || i}
              bloco={bloco}
              indice={i}
              total={blocos.length}
              aoAlterar={alterarBloco}
              aoRemover={removerBloco}
              aoMover={moverBloco}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        className="botao"
        onClick={() => {
          setBlocos((atual) => (atual ? [...atual, blocoVazio()] : [blocoVazio()]));
          setMensagem(null);
        }}
      >
        + Adicionar bloco
      </button>
    </section>
  );
}

// Licensed under the Business Source License 1.1 — see LICENSE-DRAFT.md

/**
 * Raiz da UI do Wild Studio (M3): navegação simples por estado, sem
 * router externo. Separadores: Canais, Projetos, Extensões. O detalhe do
 * canal, o editor de método, o detalhe do projeto e as entregas são
 * vistas de detalhe alcançadas a partir das listas.
 */

import { useState } from 'react';
import { DetalheCanal, ListaCanais } from './componentes/Canais.js';
import { EditorMetodo } from './componentes/MetodoEditor.js';
import { DetalheProjeto, ListaProjetos } from './componentes/Projetos.js';
import { VistaEntregas } from './componentes/Entregas.js';
import { VistaExtensoes } from './componentes/Extensoes.js';
import { NOMES_PROCESSOS } from './componentes/partes.js';
import type { ProcessoId } from './api.js';
import './estilos.css';

type Vista =
  | { ecra: 'canais' }
  | { ecra: 'canal'; canalId: number }
  | { ecra: 'metodo'; canalId: number; processo: ProcessoId }
  | { ecra: 'projetos' }
  | { ecra: 'projeto'; projetoId: number }
  | { ecra: 'entregas'; projetoId: number | null }
  | { ecra: 'extensoes' };

function migalha(vista: Vista): string | null {
  switch (vista.ecra) {
    case 'canal':
      return `Canal #${vista.canalId}`;
    case 'metodo':
      return `Canal #${vista.canalId} · Método ${NOMES_PROCESSOS[vista.processo]}`;
    case 'projeto':
      return `Projeto #${vista.projetoId}`;
    case 'entregas':
      return vista.projetoId === null ? 'Entregas' : `Entregas do projeto #${vista.projetoId}`;
    default:
      return null;
  }
}

export default function App() {
  const [vista, setVista] = useState<Vista>({ ecra: 'canais' });

  function separadorAtivo(): 'canais' | 'projetos' | 'extensoes' {
    if (vista.ecra === 'canais' || vista.ecra === 'canal' || vista.ecra === 'metodo') return 'canais';
    if (vista.ecra === 'projetos' || vista.ecra === 'projeto' || vista.ecra === 'entregas') return 'projetos';
    return 'extensoes';
  }

  const migalhaAtual = migalha(vista);

  return (
    <div className="aplicacao">
      <header className="cabecalho-app">
        <h1>Wild Studio</h1>
        <nav className="navegacao">
          <button
            type="button"
            className={separadorAtivo() === 'canais' ? 'ativo' : ''}
            onClick={() => setVista({ ecra: 'canais' })}
          >
            Canais
          </button>
          <button
            type="button"
            className={separadorAtivo() === 'projetos' ? 'ativo' : ''}
            onClick={() => setVista({ ecra: 'projetos' })}
          >
            Projetos
          </button>
          <button
            type="button"
            className={separadorAtivo() === 'extensoes' ? 'ativo' : ''}
            onClick={() => setVista({ ecra: 'extensoes' })}
          >
            Extensões
          </button>
        </nav>
      </header>

      {migalhaAtual && (
        <p className="migalha">
          {vista.ecra === 'canal' || vista.ecra === 'metodo' ? (
            <button type="button" className="botao-limpo ligacao" onClick={() => setVista({ ecra: 'canais' })}>
              Canais
            </button>
          ) : (
            <button type="button" className="botao-limpo ligacao" onClick={() => setVista({ ecra: 'projetos' })}>
              Projetos
            </button>
          )}
          {' · '}
          {vista.ecra === 'metodo' && (
            <>
              <button
                type="button"
                className="botao-limpo ligacao"
                onClick={() => setVista({ ecra: 'canal', canalId: vista.canalId })}
              >
                Canal #{vista.canalId}
              </button>
              {' · '}
            </>
          )}
          {migalhaAtual}
        </p>
      )}

      <main className="conteudo">
        {vista.ecra === 'canais' && (
          <ListaCanais aoAbrir={(id) => setVista({ ecra: 'canal', canalId: id })} />
        )}
        {vista.ecra === 'canal' && (
          <DetalheCanal
            canalId={vista.canalId}
            irParaMetodo={(_v, canalId, processo) => setVista({ ecra: 'metodo', canalId, processo })}
          />
        )}
        {vista.ecra === 'metodo' && <EditorMetodo canalId={vista.canalId} processo={vista.processo} />}
        {vista.ecra === 'projetos' && (
          <ListaProjetos
            aoAbrir={(id) => setVista({ ecra: 'projeto', projetoId: id })}
            aoVerEntregas={(id) => setVista({ ecra: 'entregas', projetoId: id })}
          />
        )}
        {vista.ecra === 'projeto' && <DetalheProjeto projetoId={vista.projetoId} />}
        {vista.ecra === 'entregas' && (
          <VistaEntregas
            projetoId={vista.projetoId}
            aoEscolherProjeto={(id) => setVista({ ecra: 'entregas', projetoId: id })}
          />
        )}
        {vista.ecra === 'extensoes' && <VistaExtensoes />}
      </main>

      <footer className="rodape">
        <p>Wild Studio · interface local do MVP — ligada à API em localhost.</p>
      </footer>
    </div>
  );
}

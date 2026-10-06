// Licensed under the Business Source License 1.1 — see LICENSE-DRAFT.md

/** Ponto de entrada da UI: monta o React no `#raiz` do `index.html`. */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';

const raiz = document.getElementById('raiz');
if (!raiz) {
  throw new Error('Elemento #raiz não encontrado no index.html.');
}

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

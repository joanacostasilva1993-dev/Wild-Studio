# Wild Studio

Wild Studio — gestor de métodos de produção de conteúdo: separa a **estratégia** (métodos, blocos,
aprovações) da **execução** (humano, IA, código via extensões independentes).

- Licença: **Business Source License 1.1** — ver `LICENSE`
  (**nome legal da licenciante por preencher antes de publicar**;
  não é uma licença open source — ver avisos no topo de `LICENSE`).
- Conceito: `CONCEITO.md`
- Especificação do MVP: `ESPECIFICACAO-MVP.md`
- Limitações honestas: `LIMITACOES.md`

## Arranque rápido

```bash
npm install

# Desenvolvimento: UI em http://localhost:5173, API em http://localhost:3000
npm run dev

# Produção: compila e serve tudo em http://localhost:3000
npm run build && npm start

npm test         # testes do núcleo
npm run typecheck
```

Variáveis de ambiente úteis: `PORT` (porta da API, omissão 3000), `DB_PATH`
(ficheiro SQLite, omissão `./dados.db`), `EXT_DIR` (diretório de extensões,
omissão `./extensoes`), `TITULOS_API_URL`/`TITULOS_API_KEY` (modo real da
extensão de referência).

## Fluxo completo (walkthrough)

Percurso de ponta a ponta na UI mínima (M3). Cada passo usa a API local em
`http://localhost:3000` — a UI é uma camada fina sobre estes endpoints, por
isso o fluxo funciona também por `curl` ou pelos guiões em `scripts/`.

1. **Criar canal** — define o nome e a ordem dos 8 processos
   (`tema`, `titulo`, `thumbnail`, `guiao`, `narracao`, `visuais`, `edicao`,
   `publicacao`).
2. **Editar método** — para cada processo, adiciona/removidos/reordena blocos:
   blocos `CRIAR` (humano ou automático via extensão) e blocos `VALIDAR`
   (aprovação humana). O editor mostra os contratos tipados de cada bloco.
3. **Criar projeto** — escolhe o canal; o projeto nasce no primeiro bloco
   do primeiro processo.
4. **Avançar** — nos blocos CRIAR humanos, submete a entrega (texto, imagem,
   áudio ou vídeo conforme o contrato); nos blocos automáticos, a entrega
   chega do job da extensão (`POST /api/jobs/executar` corre o executor).
5. **Aprovar VALIDAR** — revê a entrega e aprova (com comentário) ou rejeita;
   a rejeição devolve o bloco para nova entrega.
6. **Ver entregas** — lista todas as entregas do projeto, com estado e
   histórico de aprovações.
7. **Gerir extensões** — instala (`POST /api/extensoes/instalar`), revê o
   manifesto, dá consentimento explícito (`.../consentir`) e só então a
   extensão pode executar blocos automáticos. Remover é `DELETE
   /api/extensoes/:id`.

> Os passos acima correspondem à UI mínima e à API real, ambas testadas.

## Estado

**M1 concluído** (2026-10-06) — núcleo de métodos e execução: gramática,
contratos tipados, modelo SQLite, motor de execução com testes, API local,
blocos humanos + VALIDAR. 194 testes verdes, typecheck limpo, demo e2e OK.

**M2 concluído** (2026-10-06) — protocolo de extensões v1: manifesto
`extensao.json` validado, registo com consentimento explícito, executor de
jobs com retry/backoff, API de extensões + jobs, extensão de referência
("Títulos de Referência") e demo e2e (`scripts/demo-extensoes.mjs`).
267 testes verdes, typecheck limpo. Limitações honestas em `LIMITACOES.md`.

**M3 concluído** (2026-10-06) — UI mínima (React + Vite: lista canais/projetos,
editor de método, vista de execução com Aprovar/Rejeitar, entregas, gestão de
extensões), `npm run dev` (UI `:5173` + API `:3000`) e `npm run build && npm
start` (tudo em `:3000`); executor com `parametros` e encadeamento de entradas
ligados; licença final (`LICENSE`, nome legal por preencher) e fecho da
release **0.1.0**. 271 testes verdes, typecheck limpo.

Todo o código é original, escrito do zero (clean-room).

## Extensões (M2)

As extensões são pacotes independentes que dão aos blocos `ia`/`codigo` a
sua capacidade de execução. O núcleo só conhece o protocolo público.

**Protocolo v1 (resumo):** cada extensão traz um `extensao.json`
(`apiVersion: "1"`, `id`, `nome`, `versao`, `runtime: { tipo: "modulo",
entrada: "mao.js", exportacao: "executar" }` e `capacidades[]`). Cada
capacidade declara operador (`ia`/`codigo`), blocos e processos
compatíveis, portas de entrada/saída tipadas (§4 da especificação),
efeitos externos, custo e política de dados. O núcleo valida o manifesto,
a resposta da extensão é validada contra o contrato declarado, e métodos
que referenciam extensões ausentes continuam legíveis — só a execução
automática desse bloco fica bloqueada (falha com diagnóstico, sem "fingir"
sucesso).

**Instalar e consentir via API** (a extensão arranca sempre inativa):

```bash
# Instalar — o `resumo` serve para revisão humana antes do consentimento
curl -s -X POST http://localhost:3000/api/extensoes/instalar \
  -H 'Content-Type: application/json' \
  -d '{"caminho": "./extensions/referencia"}'

# Consentir (só depois disto a extensão pode executar)
curl -s -X POST http://localhost:3000/api/extensoes/wild-studio.titulos-referencia/consentir \
  -H 'Content-Type: application/json' \
  -d '{"consentido": true}'

# Listar, detalhe, remover
curl -s http://localhost:3000/api/extensoes
curl -s http://localhost:3000/api/extensoes/wild-studio.titulos-referencia
curl -s -X DELETE http://localhost:3000/api/extensoes/wild-studio.titulos-referencia
```

**Jobs:** `GET /api/jobs/pendentes` lista os jobs; `POST /api/jobs/executar`
corre o executor uma vez (resolve a capacidade no registo, carrega o módulo
por `import()` dinâmico, regista a entrega tipada ou agenda retry com
backoff); `POST /api/jobs/:id/repetir` repõe um job em `pendente` e limpa o
backoff. O diretório das extensões instaladas define-se com `EXT_DIR`
(omissão `./extensoes`).

**Escrever uma extensão:** ver a extensão de referência em
`extensions/referencia/` (`extensao.json`, `mao.js` com modo mock
determinista e modo real via `TITULOS_API_URL`/`TITULOS_API_KEY`, `README.md`
próprio). O módulo exporta `executar(pedido)` e devolve
`{ saidas: { <chave>: <valor> } }`, validado contra as portas declaradas.
Sem dependências npm obrigatórias.

Limitações conhecidas (honestas): ver `LIMITACOES.md` — nomeadamente,
os efeitos declarados não são uma sandbox técnica (o módulo corre
in-process: só instalar extensões de fontes confiáveis), o executor ainda
não encaminha `parametros` do bloco para o pedido da extensão, e a UI
mínima está por implementar.

## Demonstração (API)

O guião `scripts/demo.mjs` corre contra a API HTTP real e percorre o ciclo
completo do MVP: canal → métodos → projeto → execução → aprovação → entregas.

```bash
# Terminal 1 — API local (com base temporária, para não sujar dados locais)
DB_PATH=/tmp/demo.db PORT=3000 npm run dev

# Terminal 2 — guião de demonstração
API_BASE=http://localhost:3000 node scripts/demo.mjs
```

O que esperar:

1. Cria o canal **"Canal Demo"** com a ordem dos 8 processos
   (`tema`, `titulo`, `thumbnail`, `guiao`, `narracao`, `visuais`, `edicao`,
   `publicacao`).
2. Regista um método por processo: `titulo` com um bloco CRIAR + um bloco
   VALIDAR; os outros 7 com um CRIAR simples. (As saídas declaradas dos
   blocos estão temporariamente omitidas: o `submeterEntrega` do motor
   ainda não desembrulha a Porta antes de validar — ver nota no cabeçalho
   de `scripts/demo.mjs`.)
3. Cria o projeto **"Episódio 1"**.
4. Avança bloco a bloco: submete uma entrega de texto em cada bloco CRIAR
   humano em curso e aprova (com comentário) o bloco VALIDAR, até o projeto
   ficar concluído.
5. Lista as entregas e imprime um resumo.

Cada passo é impresso no terminal. O guião sai com código 1 se algum passo
falhar (ex.: a API não responde, um pedido devolve erro, ou o projeto não
conclui dentro do limite de iterações).

## Conteúdo do zip de release

A release 0.1.0 distribui-se como zip de código-fonte. Quem recebe o zip
faz `npm install && npm run build` (e `npm start` para correr em produção)
— não precisa de mais nada.

**Incluir:**

- `src/`, `server/`, `scripts/` — código-fonte (TypeScript + guiões)
- `ui/` — código-fonte da UI mínima (a incluir quando a UI existir; ainda por
  implementar — ver `LIMITACOES.md`)
- `extensions/` — extensões de exemplo (ex.: `referencia`)
- `package.json`, `package-lock.json` — dependências pinadas
- Docs `.md` da raiz: `README.md`, `CONCEITO.md`, `ESPECIFICACAO-MVP.md`,
  `LICENSE`, `LICENSE-DRAFT.md`, `LIMITACOES.md`

**Excluir:**

- `node_modules/` — recriado com `npm install`
- `dist/` — gerado com `npm run build`
- `public/` — saída de build da UI (gerada, não fonte)
- `*.db`, `*.db-journal` — dados locais de quem desenvolve/testa
- `.env` — segredos locais (nunca vão para o zip)

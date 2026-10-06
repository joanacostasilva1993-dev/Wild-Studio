# Especificação — Extensão `drift-bridge`
*Wild Studio · 2026-10-06 · rascunho técnico · para construir após o M3*

## 1. Objetivo

Uma extensão do Wild Studio que recebe as entregas de um método (narração, clips, legendas, título) e **monta + exporta o vídeo final no CutWire Drift** — editor gratuito e open-source — através do servidor MCP local do Drift. É a peça de "edição total no final", sem mensalidades.

## 2. O que é o Drift (factos verificados)

- Editor de vídeo desktop, gratuito, open-source, sem watermark (cutwire.org/drift; repo `cutwire-studios/drift`; v0.7.5 — inicial).
- **Agent access via MCP em localhost**: ligar em Settings → Agent access (desligado por omissão; token Bearer rotativo por sessão; bind só `127.0.0.1`).
- Transportes: `drift --mcp-stdio` (acopla ao editor aberto), `drift --headless` (sem janela, serve MCP sozinho — ideal para automação), `drift --headless --mcp-port 4731` (MCP sobre HTTP).
- Workflow do agente: `catalog` → `search`/`toolbox` → **`apply({ops:[...]})`** (mutações em lote, um passo de undo) → `inspect` (estado, clips, revision) → `capture`/`frames` (verificação visual) → `export_video` (assíncrono; poll em `export_status`).
- Exportação precisa de contexto OpenGL 3.3 (no PC da Joana, Windows com GPU, é pacífico; em servidor Linux headless exigiria xvfb).
- Documentação viva e em evolução — os nomes exatos das ops **devem ser confirmados em implementação** via `catalog`/`search` contra a versão fixada do Drift.

## 3. Design da extensão

**Manifesto** (`extensao.json`):
- `id`: `wild-studio.drift-bridge` · `apiVersion`: "1" · licença própria da extensão
- Capacidade `montar-e-exportar`: operador `codigo`, bloco `CRIAR`, processo `edicao`
- Efeitos declarados: `execucao_local` (lança o processo Drift, escreve o MP4 exportado)
- Custo: `gratuito`; política de dados: nenhum dado sai da máquina

**Portas de entrada** (tipos do §4 da especificação do MVP):

| Porta | Tipo | Descrição |
|---|---|---|
| `narracao` | audio/um/artefacto | Faixa de voz principal |
| `clips` | video/varios/artefacto | B-roll / clips por cena (com durações-alvo nos metadados) |
| `legendas` | texto/um/artefacto (.srt) | Legendas sincronizadas |
| `titulo` | texto/um/embutido | Título para overlay inicial |
| `parametros` | registo | formato (`9:16`/`16:9`), preset de exportação, transições |

**Porta de saída**: `video_final` — video/um/artefacto (o MP4 exportado).

**Configuração da extensão** (guardada localmente, nunca no método portátil):
- `drift_path` — caminho do executável
- `modo` — `headless` (omissão) ou `acoplado` (usa editor aberto)
- `mcp_port` — omissão 4731
- `versao_minima` — ex.: `0.7.5` (a extensão recusa correr noutra major sem revisão)

## 4. Fluxo de execução

1. Validar configuração (executável existe, versão compatível).
2. Lançar `drift --headless --mcp-port <porta> [--mcp-token <token>]` (ou ligar ao editor em modo acoplado).
3. `catalog({brief:true})` → confirmar que as ops necessárias existem naquela versão.
4. `import_media` para cada asset (caminhos absolutos; confirmar `missing:[]` vazio).
5. Construir a timeline com `apply` em lotes: colocar clips por cena, faixa de áudio da narração, importar/aplicar legendas (.srt), overlay de título, transições entre cenas.
6. `inspect({clips:true})` para confirmar a montagem; opcionalmente `capture` para verificação visual.
7. `export_video` (ou `export_with_preset`) → **poll assíncrono** até concluir (`export_status`).
8. Validar o MP4 (existe, duração > 0, codec esperado) e devolvê-lo como entrega `video_final`.
9. Terminar o processo headless (SIGTERM); em modo acoplado, deixar o projeto aberto no editor para ajuste manual.

## 5. Tratamento de erros (mapeado para o retry do executor)

- `import_failed` / ficheiro em falta → **falha imediata** (config/inputs errados; retry não resolve).
- `bad_args` / `unknown_op` (versão do Drift mudou) → **falha imediata** com diagnóstico a pedir revisão da extensão.
- `export_busy` / `export_timeout` / timeout de job → **retry com backoff** (transitório).
- Sem contexto GL (`capture_failed`, `export_failed` por render) → falha com diagnóstico ("sem contexto OpenGL; no PC com GPU isto não acontece").
- `apply` não é atómico: em `apply_failed`, registar `stopped` e as ops já aplicadas; a repetição do job recomeça de um projeto novo (nunca retomar a meio de timeline parcial).

## 6. Segurança

- Token MCP rotativo por sessão; nunca persistido em ficheiros do projeto.
- A extensão só corre após **consentimento explícito** do utilizador no Wild Studio (regra do protocolo v1).
- Sem sandbox técnica no MVP do Wild Studio (módulos correm in-process) — instalar apenas de fontes confiáveis; a `drift-bridge` é distribuída por nós.
- O Drift em si só aceita ligações em `127.0.0.1`; qualquer processo local com o token consegue usar — risco aceitável em PC pessoal, a documentar.

## 7. Âmbito da v1 da extensão / fora de âmbito

**Inclui (v1):** montagem linear por cenas, 1 faixa de vídeo + 1 de áudio, legendas SRT, título inicial, 1 transição configurável, exportação com preset, verificação do MP4.

**Fora (futuro):** máscaras/keyframes avançados, multicam, correção de cor por IA do Drift (`generate_subtitles`/`tts_generate` do próprio Drift ficam para v2 — hoje a narração e legendas vêm do método), verificação visual automática com `frames()`.

## 8. Plano de testes

- Manifesto válido/inválido (ports, ids únicos).
- Executor com **duplo do Drift** (servidor MCP falso em localhost): montagem → export simulado → entrega validada.
- Cenários de erro: `import_failed`, `unknown_op`, `export_busy` → retry, `apply_failed` parcial.
- Teste manual real (PC da Joana): Drift instalado + Agent access ligado → método de exemplo → MP4 final.

## 9. Riscos

1. **Drift v0.7.5 é inicial** — a superfície MCP pode mudar; fixar versão e rever a cada upgrade.
2. A referência a `AGENTS.md` na doc deles está quebrada (404) — sinal de docs em fluxo; confirmar tudo contra `catalog` em runtime.
3. Export headless em Linux sem GPU exige xvfb/Mesa — irrelevante no PC da Joana, relevante se um dia houver servidor.

---
*Fontes consultadas (conceitos e protocolo público; nenhum código reproduzido): cutwire.org/drift, docs/MCP.md e docs/BUILDING.md do repo cutwire-studios/drift.*

# Ponte Drift — `wild-studio.drift-bridge`

Extensão do Wild Studio que monta e exporta o vídeo final no
**CutWire Drift** (editor gratuito e open-source, alternativa ao CapCut)
através do servidor MCP local do Drift.

Capacidade `montar-e-exportar` (operador `codigo`, bloco `CRIAR`,
processo `edicao`): recebe narração, clips por cena, legendas SRT,
título e parâmetros → lança o Drift em headless → monta a timeline
via MCP → exporta o MP4 → devolve-o como entrega `video_final`.

## Pré-requisitos

- **Drift ≥ 0.7.5 instalado** (a extensão recusa major diferente de 0;
  a superfície MCP ainda evolui — ver "Limitações").
- No modo `headless` (omissão) não é preciso abrir o editor nem ligar
  nada: a extensão lança o processo sozinha.
- No modo `acoplado` (usa o editor aberto): ligar **Settings → Agent
  access** no Drift e copiar o token da sessão para `DRIFT_MCP_TOKEN`
  (o token roda a cada sessão).
- Exportação precisa de contexto OpenGL 3.3 — num PC com GPU (como o
  da Joana) é pacífico; num servidor Linux sem GPU exigiria `xvfb`.

## Instalação no Wild Studio

1. `POST /api/extensoes/instalar` com `{ "caminho": "<pasta>/extensions/drift-bridge" }`
   (a extensão instala-se **inativa**).
2. `POST /api/extensoes/{id}/consentir` após rever o resumo
   (efeitos: `execucao_local`; custo: gratuito; dados: nenhum sai da máquina).

## Configuração

Parâmetros do bloco → variáveis de ambiente → omissões:

| Parâmetro / env | Omissão | Descrição |
|---|---|---|
| `drift_path` / `DRIFT_PATH` | `drift` | Executável do Drift |
| `modo` / `DRIFT_MODO` | `headless` | `headless` ou `acoplado` |
| `mcp_port` / `DRIFT_MCP_PORT` | `4731` | Porta do MCP local |
| `mcp_token` / `DRIFT_MCP_TOKEN` | — | Token da sessão (só modo acoplado) |
| `versao_minima` / `DRIFT_VERSAO_MINIMA` | `0.7.5` | Versão mínima aceite |
| `duracao_cena` / `DRIFT_DURACAO_CENA` | `3` | Segundos por cena (ou array `duracoes`) |
| `transicao` / `DRIFT_TRANSICAO` | `nenhuma` | `nenhuma`, `fade`, `dissolve` |
| `formato` / `DRIFT_FORMATO` | `9:16` | Formato do vídeo |
| `preset_exportacao` / `DRIFT_PRESET_EXPORTACAO` | — | Preset de exportação do Drift |

## Entradas e saídas

- `narracao` (audio/um/artefacto), `clips` (video/varios/artefacto),
  `legendas` (texto/um/artefacto `.srt`, opcional),
  `titulo` (texto/um/embutido, opcional),
  `parametros` (registo opcional: formato, preset, transição).
- Saída: `video_final` (video/um/artefacto).

**Convenção de artefactos:** o núcleo referencia artefactos como
`{ id }`; esta extensão interpreta o `id` como **caminho absoluto do
ficheiro** (aceita ainda strings e `{ caminho }`). A saída devolve
`{ id: <caminho absoluto do MP4> }`.

## Semântica de erros

- **Determinísticos** (ficheiro em falta, versão incompatível, operação
  inexistente no catálogo, MP4 inválido): falham sempre igual, depressa,
  com diagnóstico acionável. Nota: no protocolo v1 o executor ainda
  tenta até 3 vezes, mas cada tentativa falha na validação antes de
  lançar o Drift.
- **Transitórios** (`export_busy`, timeouts, `apply_failed` parcial):
  o executor faz retry com backoff; cada nova tentativa recomeça de um
  projeto novo (nunca retoma timeline parcial).

## Testes

```bash
node --test extensions/drift-bridge/mao.test.mjs   # 11 testes, servidor MCP falso
npx tsx extensions/drift-bridge/validar.mjs         # manifesto contra o validador v1
```

## Limitações

- Os nomes das operações de timeline do Drift são **descobertos em
  runtime** via `catalog`/`search` (a v0.7.5 é inicial); em falta, a
  extensão falha de forma explícita em vez de adivinhar. Confirmar
  contra o `catalog` real antes de cada upgrade do Drift.
- Sem sandbox técnica no MVP (módulos correm in-process) — instalar
  apenas de fontes confiáveis.
- Durações de cena: usa `duracoes` do bloco ou `duracao_cena` omissa;
  sem análise de conteúdo dos clips na v1.
- Teste manual real (Drift instalado no PC) ainda por fazer.

# Especificação — Extensão `analisador-concorrentes` (rascunho)
*Wild Studio · 2026-10-06 · RASCUNHO — a aprovar pela Joana antes de construir*

> Ideia original da Joana (2026-10-06): dar um link do YouTube, a ferramenta
> transcreve o vídeo do concorrente, analisa a estrutura do guião (gancho,
> ritmo, pausas, CTAs), pesquisa lacunas e gera um guião **melhor e mais
> original** — nunca uma cópia.

## 1. Objetivo

Uma extensão (ou conjunto de blocos) do Wild Studio para o processo `guiao`
que implementa o workflow **análise competitiva → recriação original**:
recebe um URL de vídeo do YouTube e devolve uma análise estrutural +
um guião novo, transformador, pronto para o bloco VALIDAR humano.

## 2. Porquê agora (contexto estratégico)

- A 1 de outubro de 2026 o YouTube anunciou que o sistema de recomendações
  dos Shorts vai **privilegiar conteúdo original e reduzir o alcance de
  canais que republicam vídeos alheios sem transformação real** — um simples
  recorte, legendas ou logótipo já não conta como originalidade; a plataforma
  exige comentário, análise ou montagem que transforme realmente o material.
  (fonte: thereelstars.com, notícia de 2026-10-06)
- Conclusão: a regra de transformatividade abaixo **não é higiene legal —
  é requisito de sobrevivência algorítmica**. O que esta extensão produz
  (nova análise, pesquisa de lacunas, texto novo) está do lado protegido;
  republicar com retoques está do lado penalizado.

## 3. Método-modelo (blocos)

```
PESQUISAR  (codigo)  sacar transcrição do URL  → transcricao
CRIAR      (ia)      analisar estrutura        → analise
CRIAR      (ia)      pesquisar lacunas         → lacunas
CRIAR      (ia)      gerar guião melhorado     → guiao_novo
VALIDAR    (humano)  a Joana aprova/edita      → guiao_final
```

Cada bloco recebe as entregas do anterior (encadeamento já suportado no
executor desde o M3: `parametros` + inputs encadeados).

## 4. Design da extensão

**Manifesto** (`extensao.json`):
- `id`: `wild-studio.analisador-concorrentes` · `apiVersion`: "1"
- Capacidades (operador / bloco / processo):
  - `transcrever-youtube`: `codigo` / `PESQUISAR` / `guiao`
  - `analisar-estrutura`: `ia` / `CRIAR` / `guiao`
  - `pesquisar-lacunas`: `ia` / `CRIAR` / `guiao`
  - `gerar-guiao`: `ia` / `CRIAR` / `guiao`
- Efeitos declarados: `leitura_externa` (YouTube + LLM via rede)
- Custo: `gratuito` (transcrição gratuita do YouTube; LLM via OpenRouter
  `:free` com failover, mesma estratégia do router do shorts-forge)
- Política de dados: o URL e a transcrição saem para o provider de LLM
  escolhido; nada é publicado em lado nenhum

**Portas de entrada** (tipos do §4 da especificação do MVP):

| Porta | Tipo | Descrição |
|---|---|---|
| `url_video` | url (controlo) | Link do YouTube a analisar |
| `idioma_alvo` | selecao | pt-PT / pt-BR / fr / en (línguas prioritárias da Joana) |
| `formato` | selecao | short 9:16 / longo 16:9 (orçamentos de texto por segmento) |
| `tom` | texto/um/embutido | tom desejado para o guião novo (opcional) |

**Portas de saída**:

| Porta | Tipo | Descrição |
|---|---|---|
| `transcricao` | texto/um/artefacto | transcrição com timestamps (intermédia) |
| `analise` | texto/um/artefacto | estrutura detetada: gancho, ritmo, pausas, CTAs, pontos fracos |
| `lacunas` | texto/um/artefacto | o que o vídeo original não cobre (pesquisa adicional) |
| `guiao_novo` | texto/um/artefacto | guião transformador, pronto para VALIDAR |

## 5. Regra de transformatividade (REQUISITO, não opção)

O prompt de geração **exige**, e a validação do contrato **rejeita** saídas
que violem:

1. **Estrutura inspirada, texto novo** — nunca reproduzir frases do guião
   alheio; semelhança textual medida e limitada (threshold a definir em
   implementação; excesso → bloco `falhou` com diagnóstico).
2. **Comentário/análise/montagem que transforme** — o guião novo tem de
   acrescentar: nova perspetiva, dados/lacunas pesquisadas, estrutura
   própria. "Melhor" detetável em: gancho mais forte, ritmo, cobertura.
3. **"Melhor" é subjetivo** — a análise deteta padrões, mas o julgamento
   final é da Joana no bloco VALIDAR. A ferramenta acelera, não substitui
   o olho dela.

## 6. Fluxo de execução (detalhe por capacidade)

1. `transcrever-youtube`: obter transcrição (legendas do YouTube quando
   existirem; fallback: descarregar áudio e transcrever localmente).
   Falha imediata se o vídeo não tiver transcrição acessível nem áudio
   descarregável.
2. `analisar-estrutura`: LLM (OpenRouter `:free` + failover) extrai gancho,
   blocos temáticos, ritmo (palavras/min, pausas), CTAs, pontos fracos.
   Saída em formato estruturado validado contra o contrato.
3. `pesquisar-lacunas`: LLM pesquisa o tema e lista o que o original não
   cobre — factos, ângulos, exemplos. É aqui que nasce a "mais-valia".
4. `gerar-guiao`: LLM gera o guião novo (com a regra do §5 no system
   prompt), no idioma e formato-alvo, com durações por segmento
   compatíveis com os orçamentos de caption (pt28/fr30/en34).
5. `VALIDAR`: a Joana aprova, edita ou rejeita (rejeição volta ao bloco
   de geração com o comentário dela como instrução).

## 7. Tratamento de erros (mapeado para o retry do executor)

- URL inválido / vídeo indisível / sem transcrição → **falha imediata**
  (config/inputs; retry não resolve).
- 429 / timeout do provider LLM → **retry com backoff** (transitório);
  o router faz failover para o próximo provider `:free` antes de falhar.
- Saída do LLM inválida contra o contrato → retry (até 3, como o M2);
  depois, bloco `falhou` — nunca "finge" sucesso.
- Violação da regra de transformatividade (§5) → **falha imediata** com
  diagnóstico (não é transitório; exige revisão de prompt).

## 8. Âmbito da v1 / fora de âmbito

**Inclui (v1):** 1 URL por execução; transcrição + análise + lacunas +
guião; pt-PT/pt-BR/fr/en; short e longo; VALIDAR humano obrigatório.

**Fora (futuro):** análise de múltiplos concorrentes em lote; análise de
áudio/visual do vídeo (só texto na v1); publicação direta; deteção
automática de "melhor" (fica o olho humano).

## 9. Plano de testes

- Transcrição: vídeo com legendas / sem legendas (fallback) / URL inválido.
- Contrato: saídas válidas/inválidas por capacidade; violação de
  transformatividade rejeitada.
- Executor: retry em 429 simulado; failover de provider; VALIDAR
  aprova/rejeita; linhagem das entregas preservada.
- Mock do LLM para testes determinísticos (modo `mock` como na extensão
  de referência `wild-studio.titulos-referencia`).

---
*Próximo passo quando a Joana disser "vamos": construir em
`extensions/analisador-concorrentes/`, estritamente aditivo (não tocar em
`ui/`, `server/`, `src/api/`, `src/engine/`), como foi feito com a
`drift-bridge`.*

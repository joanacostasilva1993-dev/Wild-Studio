# Especificação do MVP
*2026-10-06 · rascunho técnico para discussão · clean-room: conceitos originais, código a escrever do zero*

## 1. Objetivo do MVP

Provar o ciclo completo **método → execução → aprovação → entrega** com um núcleo agnóstico e uma extensão de referência. No fim do MVP, um utilizador consegue: criar um canal, desenhar um método simples, executar um projeto passo a passo com aprovações humanas, e ver as entregas tipadas resultantes.

## 2. Stack proposta

- **TypeScript** (Node 22+) — mesma linguagem do núcleo e das extensões; equipa já trabalha em TS.
- **SQLite** (better-sqlite3) — persistência local, zero infraestrutura, ficheiro único por instalação.
- **API local** (Express ou similar) — o núcleo expõe HTTP em localhost; a UI e futuras superfícies consomem a mesma API.
- **UI web mínima** (React + Vite) — só o essencial: gerir métodos, executar projetos, aprovar blocos, ver entregas.
- **Testes desde o dia um** — núcleo de execução com testes de transição de estados (o motor é o coração; não pode ter ambiguidade).

*Decisão a confirmar: Electron para desktop fica para depois do MVP (anti-meta). O MVP corre como API + UI web local.*

## 3. Gramática do método

### 3.1 Processos
Oito processos universais, cada projeto percorre os oito; **a ordem é definida por canal** e congelada no snapshot do projeto:

1. `tema` — Tema
2. `titulo` — Título
3. `thumbnail` — Thumbnail
4. `guiao` — Guião
5. `narracao` — Narração e Áudio
6. `visuais` — Assets Visuais
7. `edicao` — Edição
8. `publicacao` — Publicação

### 3.2 Blocos
Cada passo estratégico de um método é um de quatro blocos:

| Bloco | Intenção |
|---|---|
| `PESQUISAR` | Obter material/informação (ex.: pesquisar B-roll, pesquisar referências) |
| `ESCOLHER` | Selecionar entre opções (ex.: escolher título, escolher thumbnail) |
| `CRIAR` | Produzir conteúdo novo (ex.: gerar guião, sintetizar narração) |
| `VALIDAR` | Aprovação humana explícita antes de prosseguir |

### 3.3 Operadores
Cada bloco é executado por exatamente um operador: `humano`, `ia` ou `codigo`.
O operador `humano` é sempre válido — o núcleo funciona com zero extensões.

### 3.4 Regras de composição
- Um método = sequência ordenada de blocos dentro de cada processo.
- Blocos têm **entradas e saídas tipadas** (ver §4). As portas pertencem ao bloco, nunca ao executor: trocar o executor não altera o contrato.
- `VALIDAR` só aceita operador humano e produz um veredito de aprovação.
- Separar blocos quando o resultado intermédio tem valor próprio (reutilizável, aprovável, substituível). Manter junto quando os intermediários são descartáveis.

## 4. Contratos tipados

Um único sistema de tipos em todas as fronteiras (método, motor, extensões, UI).

### 4.1 Conteúdo
Quatro famílias — `texto`, `imagem`, `audio`, `video` — cada valor descrito por:

```
familia:       texto | imagem | audio | video
cardinalidade: um | varios
representacao: embutido | artefacto | ambos
formatos?:     { mimeTypes?: string[], extensoes?: string[] }
```

Texto pode ser embutido (inline) ou artefacto (ex.: `.srt`, `.md` continuam a ser `texto`). Imagem/áudio/vídeo são artefactos (ficheiros referenciados por ID).

### 4.2 Controlos
Valores que não são conteúdo: `identificador`, `numero`, `booleano`, `selecao`, `datahora`, `url`, `aprovacao`. Controles nunca são apresentados como conteúdo.

### 4.3 Registos
Estruturas com campos nomeados, cada campo com o seu tipo (conteúdo ou controlo), obrigatoriedade e cardinalidade. Sem "quinta família".

### 4.4 Compatibilidade
Duas portas ligam-se se e só se: mesmo tipo e cardinalidade; conteúdos com mesma família e representação compatível; formatos com interseção não vazia; controlos do mesmo tipo com opções compatíveis. **Sem coerção implícita, sem inferência por nomes.**

## 5. Modelo de dados (SQLite)

| Tabela | Papel |
|---|---|
| `canais` | Um canal = uma estratégia: nome, ordem dos 8 processos, método por processo |
| `metodos` | Definição versionada: blocos, portas, parâmetros, operador e extensão por bloco |
| `projetos` | Instância de trabalho; captura **snapshot imutável** do método + ordem no arranque |
| `execucoes_processo` | Estado de cada processo dentro do projeto |
| `execucoes_bloco` | Estado de cada bloco: `pendente → em_curso → aguardar_aprovacao → concluido | falhou | cancelado` |
| `entregas` | Valores produzidos, com ID único, tipo, linhagem (bloco+tentativa de origem) |
| `artefactos` | Ficheiros (áudio, imagem, vídeo) referenciados por entrega |
| `aprovacoes` | Vereditos humanos: quem, quando, decisão, comentário |
| `tentativas` | Histórico de retries por bloco (factos imutáveis; retry nunca apaga) |

Regras:
- Editar o método do canal **não** altera projetos em curso (só novos projetos usam a nova versão); execuções encerradas mantêm a definição histórica.
- Entregas são imutáveis; correções criam novas entregas com nova linhagem.

## 6. Motor de execução

- Transições de estado **puras e testadas**: cada transição (avançar, aprovar, rejeitar, repetir, cancelar, retomar) é uma função determinista sobre o estado + intenção, com testes unitários.
- Blocos `humano` aguardam intenção do utilizador; blocos `ia`/`codigo` criam um *job* persistido antes de delegar à extensão — se o processo morrer, o job retoma sem perder trabalho.
- `VALIDAR` pausa a execução até veredito explícito; rejeição devolve o fluxo ao bloco anterior configurado.
- Falhas de extensão: retry com backoff configurável; após esgotar, bloco fica em `falhou` com diagnóstico — nunca "finge" sucesso.
- Concorrência do MVP: **um bloco automático de cada vez** (paralelismo fica para depois).

## 7. Protocolo de extensões v1 (mínimo viável)

Manifesto `extensao.json` na raiz do pacote:

```json
{
  "apiVersion": "1",
  "id": "exemplo.titulos-ia",
  "nome": "Títulos IA",
  "versao": "0.1.0",
  "autor": "…",
  "licenca": "…",
  "capacidades": ["…"]
}
```

Cada **capacidade** declara: operador (`ia`/`codigo`), blocos compatíveis, processos compatíveis, portas de entrada/saída (com tipos do §4), efeitos externos (`leitura_externa`, `escrita_externa`, `execucao_local`), modelo de custo e política de dados (que dados saem para que fornecedores).

Garantias do núcleo:
- Só conhece o protocolo público; **nenhum ID, endpoint ou segredo de fornecedor** no núcleo.
- Valida manifesto, portas e permissões antes de ativar; pede consentimento explícito ao utilizador.
- Resposta da extensão é validada contra o contrato declarado antes de ser aceite como entrega.
- Extensões são instaladas/removidas sem tocar no núcleo; método que referencia extensão ausente continua legível, mas a execução automática desse bloco fica bloqueada.

## 8. Superfícies do MVP

1. **API local** (`localhost`): canais, métodos, projetos, execuções, aprovações, entregas, extensões. Documentada (OpenAPI).
2. **UI web mínima**: lista de canais/projetos; editor simples de método (adicionar/remover/reordenar blocos); vista de execução com progresso e botões de aprovar/rejeitar; vista de entregas.
3. **CLI mínima** (nice-to-have do MVP): `executar`, `estado`, `aprovar` — útil para agentes e scripts.

Fora do MVP: instalador desktop, auto-update, loja/catálogo de extensões, agendamento recorrente, multi-utilizador, mobile.

## 9. Licença

**Business Source License 1.1** (texto-padrão, gratuito), licença final em `LICENSE`
(parâmetros preenchidos; nome legal da licenciante por preencher antes de publicar):
- Uso em produção por terceiros: **não permitido** sem licença comercial (Additional Use Grant: None).
- Cópia, modificação, redistribuição e uso não-produtivo: permitidos.
- **Change Date: 2030-10-06** → a partir daí, o código passa a **GPL-3.0-or-later**.
- Por preencher antes de publicar: nome legal da licenciante + nome final do projeto.
- Não anunciar como "open source". Registar marca (INPI Portugal). Revisão por advogado antes de uso comercial sério.

## 10. Milestones

- **M1 — Núcleo de métodos e execução** (sem extensões): gramática, contratos, modelo de dados, motor com testes, API local, blocos humanos + VALIDAR funcionais.
- **M2 — Protocolo de extensões**: manifesto, validação, sandbox de permissões, consentimento; **extensão de referência** (ex.: gerar títulos via LLM) para provar o protocolo de ponta a ponta.
- **M3 — UI mínima + fecho**: editor de método, vista de execução/aprovação, entregas; documento de estado atual e limitações; release 0.1.0 com licença preenchida.

Critério de "pronto" por milestone: testes verdes, documento de limitações atualizado, release verificável por terceiros sem ajuda da autora.

## 11. Riscos e notas

- O motor de execução é o componente de maior risco técnico — investir em testes de transição desde o dia um.
- Não crescer a gramática no MVP: qualquer "novo tipo de bloco" proposto deve primeiro tentar exprimir-se por composição dos existentes.
- Energia dividida com o Shorts-Forge: decidir cadência (ex.: sprints alternados) antes de arrancar.
- A proteção da licença depende também de marca registada e de execução rápida — licença sozinha não vence mercado.

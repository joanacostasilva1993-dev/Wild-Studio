# CONCEITO — Nova ferramenta de produção de conteúdo
*Documento de trabalho · 2026-10-06 · rascunho para discussão*

## 1. Visão (uma frase)

Uma ferramenta que ajuda criadores a **desenhar o seu método de produção de conteúdo e executá-lo com ajuda de IA** — sem esconder o processo numa caixa-preta e sem os prender a um único fornecedor.

## 2. O problema

Geradores "1 clique" produzem conteúdo genérico, repetitivo e vulnerável a desmonetização. Ferramentas profissionais são caixas-pretas: o criador não controla o processo, não aprova etapas, não reutiliza o que funcionou. Quem vive de conteúdo precisa de **método** (estratégia repetível) + **execução assistida** (velocidade), mantendo o controlo editorial.

## 3. Princípios fundadores

1. **Clean-room total.** Inspiramo-nos em *conceitos* (separação estratégia/execução, blocos, aprovações, contratos tipados) — nunca em código, textos, diagramas ou schemas de terceiros. Todo o código é original, escrito do zero.
2. **A estratégia pertence ao criador.** O método é dele: desenhável, editável, partilhável, versionado.
3. **Aprovação humana é de primeira classe.** Nada de valor publica sem passar por um ponto de validação explícito.
4. **Núcleo agnóstico, execução plugável.** O núcleo não conhece fornecedores (OpenAI, Pexels, YouTube…); isso vive em extensões independentes.
5. **Funciona sem extensões.** Com zero plugins instalados, continua a ser um gestor de métodos com blocos executados por humanos.
6. **Documentação honesta.** Um documento vivo de estado atual e limitações, atualizado a cada release — sem prometer o que não foi verificado.

## 4. Conceitos a aproveitar (em espírito, não em código)

- **Separação estratégia ↔ execução.** O método diz *como*; executores (humano, IA, código) dizem *quem faz*.
- **Gramática pequena e universal.** Poucos tipos de processo (ex.: tema, título, thumbnail, guião, narração, visuais, edição, publicação), poucos tipos de bloco (pesquisar, escolher, criar, validar), poucos operadores. Tudo o resto é composição.
- **Contratos tipados em todas as fronteiras.** Texto, imagem, áudio, vídeo; um ou vários; embutido ou artefacto. As entradas/saídas pertencem ao bloco, nunca ao executor — trocar o executor não quebra o método.
- **Entregas com identidade e proveniência.** Cada resultado tem ID, linhagem e histórico; retries não apagam factos.
- **Orquestrador agenda, não decide.** Filas decidem *quando* avançar; a estratégia congelada no projeto decide *o quê*.
- **Ecossistema de extensões independentes.** Manifesto, capacidades declaradas (portas, permissões, efeitos, custo, política de dados), sandbox, consentimento. Extensões têm licença e distribuição próprias.

## 5. O que fazemos diferente (diferenciação)

1. **Video-first para criadores.** Nascida para o pipeline de vídeo (YouTube, Shorts, TikTok), com execução real por baixo — não um gestor genérico de tarefas.
2. **Licença protetiva source-available** (ver §7) em vez de open source permissivo: o código é legível, mas clones e derivados concorrentes são proibidos.
3. **Português europeu e multi-língua desde o dia um**; local-first onde fizer sentido; sem defaults presos a um só ecossistema regional.
4. **Agent-native.** Métodos desenhados para serem executados também por agentes de IA (protocolo aberto, MCP), não só por humanos a clicar.
5. **Escopo disciplinado.** Começar pequeno e crescer por composição de primitivas — nunca por acumulação de modos especiais.

## 6. Âmbito do MVP (deliberadamente pequeno)

**Inclui:**
- Núcleo: canais, projetos, métodos (processos + blocos + operadores), contratos tipados texto/imagem/áudio/vídeo, execuções com snapshots, bloco VALIDAR com aprovação humana, persistência local.
- Uma superfície simples: criar método, executar passo a passo, aprovar, ver entregas.
- Uma extensão de referência mínima (ex.: gerar títulos via LLM) para provar o protocolo de extensões.

**Fica de fora (anti-metas do MVP):**
- App desktop instalável, auto-update, loja de extensões, automação de navegador, agendamento/orquestrador multi-canal, analytics, colaboração multi-utilizador, mobile.

## 7. Licença: proteger sem copiar

**Objetivo da Joana:** código legível (transparência/confiança), mas sem autorização para clones, rebrandings ou produtos concorrentes derivados.

**Opções honestas** (nenhuma é "open source" no sentido OSI — e não deve ser anunciada como tal):

| Opção | Como funciona | Prós | Contras |
|---|---|---|---|
| **Business Source License 1.1** (MariaDB) | Source-available; proíbe uso em produção concorrente; **converte-se em open source** (ex.: GPL/Apache) após data definida (máx. 4 anos) | Reputada, texto pronto, equilíbrio proteção↔confiança; a conversão futura atrai comunidade | Proteção expira na data de conversão |
| **PolyForm Shield** | Proíbe competir com o produto; perpétua | Simples, texto pronto, sem data de expiração | Menos conhecida; proteção depende da definição de "competir" |
| **PolyForm Noncommercial** | Proíbe uso comercial por terceiros | Muito simples | Bloqueia também usos comerciais legítimos (ex.: agências) |
| **Licença proprietária própria** (via advogado) | Texto à medida | Controlo máximo, ajustada ao caso | Custo, tempo, menos confiança inicial |

**Recomendação:** começar com a **BSL 1.1** — é a mais credível do mercado para este objetivo, não exige advogado para adotar, e a conversão futura em open source é um argumento de confiança (e até de marketing). Se a proteção perpétua for inegociável, PolyForm Shield.

**Não fazer:**
- Copiar o texto da licença de terceiros (o texto da licença também tem direitos de autor).
- Anunciar como "open source".
- Esquecer a **marca**: registar nome + logótipo (em Portugal: INPI) — o copyright não protege nomes.
- Dispensar revisão jurídica antes de uso comercial sério ou de contribuições externas. *(Não sou advogada; isto não é aconselhamento jurídico.)*

## 8. Riscos principais

1. **Escopo.** O produto de referência levou anos até à v1.3.7. O MVP acima é a única forma de não morrer na praia.
2. **Concorrência assimétrica.** Competir frontalmente com produto maduro exige diferenciação nítida (§5) — não "o mesmo, mas meu".
3. **Energia dividida.** Este é um segundo projeto grande ao lado do Shorts-Forge. Decidir ritmo e prioridade antes de começar.
4. **Confiança vs. proteção.** Licença restritiva atrai menos contribuidores; compensar com transparência (código legível, docs honestas, releases verificáveis).

## 9. Próximos passos propostos

1. Validar este conceito (visão, diferenciação, MVP, licença).
2. Escolher nome provisório e verificar disponibilidade (domínio, GitHub, INPI).
3. Definir licença final (BSL 1.1 proposta) e redigir aviso jurídico mínimo.
4. Escrever a especificação do MVP: gramática (processos/blocos/operadores), contratos tipados, modelo de dados.
5. Montar equipa de agentes e arrancar pelo núcleo (métodos + execução + VALIDAR), sem extensões primeiro.

---
*Nota de higiene: este documento descreve intenções e conceitos. Nenhum código, texto ou diagrama de terceiros foi reproduzido aqui.*

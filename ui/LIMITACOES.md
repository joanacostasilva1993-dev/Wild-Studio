# Limitações conhecidas

Documento honesto do que o Wild Studio **ainda não faz** (M1 + M2 + M3, estado em
2026-10-06). Atualizado a cada milestone; nada aqui é "brevemente" — ou está
feito e testado, ou está nesta lista.

## M3 — UI mínima (implementada)

- **UI mínima funcional** (React + Vite, em `ui/`): lista de canais e
  projetos; editor de método (adicionar/remover/reordenar blocos, operador,
  portas só de leitura, `parametros` como JSON validado); vista de execução
  com progresso, botões **Aprovar/Rejeitar** nos VALIDAR e submissão de
  entregas em blocos humanos; vista de entregas; gestão básica de extensões
  (listar, instalar por caminho, consentir/desativar, remover). A limitação
  "Sem UI" do M1 **deixa de se aplicar**.
- A UI destina-se a uso local (`localhost`), sem login — as limitações "Sem
  autenticação" e "Sem paralelismo" do M1 aplicam-se igualmente à
  interface. Em dev: UI em `:5173` (proxy `/api` → `:3000`); em produção
  (`npm run build && npm start`): tudo em `:3000`.

## Extensões (M2, ainda válidas)

- **Sem sandbox técnica.** Os efeitos declarados no manifesto
  (`leitura_externa`, `escrita_externa`, `execucao_local`) são
  **declarativos**: o módulo da extensão corre *in-process*, no mesmo processo
  Node do núcleo, com acesso total ao runtime. O consentimento explícito é
  uma decisão administrativa (flag `ativa`), não confinamento. **Só instalar
  extensões de fontes confiáveis, com código revisto.** Confinamento real
  (worker isolado, permissões de ficheiros/rede) está fora do âmbito do MVP.
- **Parâmetros e encadeamento ligados (M3).** O executor lê os `parametros`
  do bloco no snapshot imutável do projeto e preenche as `entradas` com as
  entregas dos blocos anteriores do mesmo projeto, mapeadas pelas chaves
  das portas de entrada declaradas no método (chave sem entrega é omitida;
  em conflito, vence a entrega mais recente). Consequência visível: a
  extensão de referência usa agora o `tema` dos `parametros` em vez do
  genérico `"o teu próximo vídeo"`.
- **Encadeamento é por chave de porta, não por ligação explícita.** Não há
  arestas declaradas entre blocos: o valor chega à entrada quando a chave
  da porta de saída de um bloco anterior coincide com a chave da porta de
  entrada. Blocos do mesmo projeto com chaves iguais "falam" entre si sem
  configuração adicional — documentado aqui para não surpreender.
- **Um job de cada vez, sem agendador.** O executor corre os jobs em
  sequência; falhas transitórias (exceção, timeout, violação de contrato)
  fazem retry com backoff exponencial via `proxima_execucao`, mas **é preciso
  voltar a chamar `POST /api/jobs/executar`** após o backoff — não há
  agendamento automático no MVP. Erros de configuração (extensão ausente ou
  inativa, capacidade incompatível) falham de imediato, sem retry.
- **Modo real da extensão de referência precisa de chave.** Sem
  `TITULOS_API_URL` + `TITULOS_API_KEY`, a extensão corre em modo mock
  (determinista, local). O modo real exige um endpoint compatível com
  chat-completions da OpenAI.

## Núcleo (M1, ainda válidas)

- **Sem autenticação.** A API destina-se a `localhost`; não há utilizadores,
  sessões nem controlo de acesso. Não expor à rede sem uma camada à frente.
- **Sem paralelismo.** Um bloco de cada vez por projeto; um job de cada vez
  no executor.
- **SQLite local.** Um ficheiro por instalação (`DB_PATH`); sem
  multi-utilizador nem replicação.

## Fora do MVP (não planeado para já)

Instalador desktop, auto-update, loja/catálogo de extensões, agendamento
recorrente, mobile, multi-utilizador. Ver `ESPECIFICACAO-MVP.md` §8.

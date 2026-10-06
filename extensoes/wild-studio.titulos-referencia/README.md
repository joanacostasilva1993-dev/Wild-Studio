# Títulos de Referência

Extensão de referência do protocolo de extensões (M2) do Wild Studio.
Gera 5 títulos em português europeu a partir de um tema — serve de exemplo
mínimo e completo de como escrever, instalar e executar uma extensão.

- Licença: **Business Source License 1.1** (ver `LICENSE` na raiz do projeto).
- Sem dependências npm: só `fetch` global (Node 22+).

## O que faz

Capacidade `gerar-titulos` (operador `ia`, bloco `CRIAR`, processo `titulo`):

- **entrada** `tema` — texto / um / embutido (via `pedido.entradas.tema`,
  com fallback para `pedido.bloco.parametros.tema`);
- **saída** `titulos` — texto / varios / embutido: exatamente 5 strings.

Responde sempre `{ saidas: { titulos: [...] } }`. O núcleo valida a resposta
contra a porta declarada antes de a aceitar como entrega.

> **Nota (limitação M2):** o executor ainda não encaminha `parametros` do
> bloco nem valores de entradas — o pedido chega com `entradas: {}` e sem
> `bloco.parametros`. Até o motor o suportar, a extensão usa o tema
> genérico `"o teu próximo vídeo"` quando não recebe tema nenhum; os
> `parametros: { tema }` do método ficam registados e serão usados assim que
> o executor os encaminhar. Ver `LIMITACOES.md` na raiz do projeto.

## Modo mock vs. modo real

- **Mock (omissão):** 5 títulos deterministas a partir de modelos em pt-PT.
  Nenhum dado sai da máquina. É o modo usado na demo e nos testes.
- **Real:** se `TITULOS_API_URL` estiver definido, faz `POST` para um
  endpoint compatível com chat-completions da OpenAI e pede 5 títulos em
  JSON (parse defensivo). Em falha lança `Error` para o executor fazer retry.

Variáveis de ambiente:

| Variável          | Obrigatória no modo real | Omissão      |
|-------------------|--------------------------|--------------|
| `TITULOS_API_URL` | sim (ativa o modo real)  | — (mock)     |
| `TITULOS_API_KEY` | sim                      | —            |
| `TITULOS_MODELO`  | não                      | `gpt-4o-mini`|

## Instalar via API

A API tem de estar a correr a partir da raiz do projeto (o `caminho`
resolve-se contra o diretório de trabalho do servidor):

```bash
# 1. Instalar (a extensão arranca INATIVA; o `resumo` serve para revisão)
curl -s -X POST http://localhost:3000/api/extensoes/instalar \
  -H 'Content-Type: application/json' \
  -d '{"caminho": "./extensions/referencia"}'

# 2. Consentir (só depois disto a extensão pode executar)
curl -s -X POST http://localhost:3000/api/extensoes/wild-studio.titulos-referencia/consentir \
  -H 'Content-Type: application/json' \
  -d '{"consentido": true, "nota": "Extensão de referência, código revisto."}'

# 3. Listar / detalhe / remover
curl -s http://localhost:3000/api/extensoes
curl -s http://localhost:3000/api/extensoes/wild-studio.titulos-referencia
curl -s -X DELETE http://localhost:3000/api/extensoes/wild-studio.titulos-referencia
```

## Usar num método

Bloco `CRIAR` com operador `ia` no processo `titulo`:

```json
{
  "id": "titulo-criar-ia",
  "tipo": "CRIAR",
  "operador": "ia",
  "titulo": "Gerar títulos com IA",
  "extensaoId": "wild-studio.titulos-referencia",
  "parametros": { "tema": "como organizar a semana" },
  "saidas": [
    {
      "chave": "titulos",
      "rotulo": "Títulos",
      "tipo": {
        "tipo": "conteudo",
        "familia": "texto",
        "cardinalidade": "varios",
        "representacao": "embutido"
      }
    }
  ]
}
```

## Testes

```bash
node --test extensions/referencia/mao.test.mjs
```

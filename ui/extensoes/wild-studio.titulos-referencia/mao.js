// Licensed under the Business Source License 1.1 — see LICENSE

/**
 * "Títulos de Referência" — extensão de referência do protocolo M2.
 *
 * Capacidade `gerar-titulos` (operador `ia`, bloco CRIAR, processo titulo):
 * gera 5 títulos em português europeu a partir de um tema.
 *
 * Contrato:
 * - pedido: `{ entradas?: { tema? }, bloco?: { parametros?: { tema? } }, ... }`
 * - resposta: `{ saidas: { titulos: string[5] } }` (casa com a porta
 *   `titulos`: texto / varios / embutido declarada no manifesto)
 *
 * Modos:
 * - mock (omissão): 5 títulos deterministas a partir de modelos em pt-PT;
 *   nenhum dado sai da máquina;
 * - real: se `TITULOS_API_URL` estiver definido, faz POST para um endpoint
 *   compatível com chat-completions da OpenAI (`TITULOS_API_KEY`,
 *   `TITULOS_MODELO` opcional, omissão `gpt-4o-mini`). Em falha lança
 *   `Error` para o executor fazer retry.
 *
 * Sem dependências npm: só `fetch` global (Node 22+).
 */

const NUMERO_TITULOS = 5;

const MODELOS_PT = [
  '{tema}: o guia essencial para começar hoje',
  'Como dominar {tema} em 5 passos simples',
  '{tema} — 7 erros comuns (e como evitá-los)',
  'O que ninguém te conta sobre {tema}',
  '{tema} para principiantes: o ponto de partida',
  'Transforma a tua rotina com {tema}',
  '{tema}: estratégias que realmente funcionam',
  'Porque é que {tema} muda tudo',
];

/** Dispersão simples (FNV-like) para variar os modelos por tema, com determinismo. */
function dispersao(texto) {
  let h = 2166136261;
  for (const c of texto) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Extrai o tema do pedido: `entradas.tema`, com fallback para `bloco.parametros.tema`. */
function obterTema(pedido) {
  const tema = pedido?.entradas?.tema ?? pedido?.bloco?.parametros?.tema;
  if (typeof tema === 'string' && tema.trim() !== '') {
    return tema.trim();
  }
  // Desde o M3 o executor encaminha `parametros` do bloco e encadeia
  // `entradas` a partir de blocos anteriores. Só se usa o tema genérico
  // quando o método não declara tema nenhum — a extensão continua funcional
  // de ponta a ponta. Ver LIMITACOES.md.
  return 'o teu próximo vídeo';
}

/** Gera 5 títulos deterministas a partir dos modelos em pt-PT. */
function gerarTitulosMock(tema) {
  const inicio = dispersao(tema) % MODELOS_PT.length;
  const titulos = [];
  for (let i = 0; i < NUMERO_TITULOS; i += 1) {
    titulos.push(MODELOS_PT[(inicio + i) % MODELOS_PT.length].replaceAll('{tema}', tema));
  }
  return titulos;
}

function validarTitulos(titulos, origem) {
  if (
    !Array.isArray(titulos) ||
    titulos.length !== NUMERO_TITULOS ||
    titulos.some((t) => typeof t !== 'string' || t.trim() === '')
  ) {
    throw new Error(
      `${origem}: resposta inválida — esperados exatamente ${NUMERO_TITULOS} títulos em texto não vazio.`,
    );
  }
  return titulos;
}

/** Tenta interpretar texto como JSON com `{ titulos: [...] }` ou `[...]`. */
function extrairTitulosDoTexto(texto) {
  const candidatos = [texto];
  const objeto = texto.match(/\{[\s\S]*\}/);
  if (objeto) {
    candidatos.push(objeto[0]);
  }
  for (const candidato of candidatos) {
    try {
      const parsed = JSON.parse(candidato);
      const lista = Array.isArray(parsed) ? parsed : parsed?.titulos;
      if (Array.isArray(lista)) {
        return lista;
      }
    } catch {
      // tenta o próximo candidato
    }
  }
  throw new Error('Não foi possível interpretar a resposta do fornecedor como JSON com 5 títulos.');
}

/** Modo real: pede 5 títulos a um endpoint compatível com chat-completions. */
async function gerarTitulosReal(tema) {
  const url = process.env.TITULOS_API_URL;
  const chave = process.env.TITULOS_API_KEY;
  if (!chave) {
    throw new Error(
      "Modo real da extensão 'Títulos de Referência': define TITULOS_API_KEY " +
        '(e TITULOS_API_URL) ou remove TITULOS_API_URL para usar o modo mock.',
    );
  }
  const modelo = process.env.TITULOS_MODELO ?? 'gpt-4o-mini';

  let resposta;
  try {
    resposta = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${chave}`,
      },
      body: JSON.stringify({
        model: modelo,
        messages: [
          {
            role: 'system',
            content:
              'És um redator de títulos para vídeos curtos. Respondes APENAS com JSON ' +
              'no formato {"titulos": ["...", "...", "...", "...", "..."]}, com exatamente ' +
              '5 títulos apelativos em português europeu, sem numeração nem texto extra.',
          },
          { role: 'user', content: `Tema: ${tema}` },
        ],
        temperature: 0.8,
        response_format: { type: 'json_object' },
      }),
    });
  } catch (erro) {
    throw new Error(
      `Falha a contactar o fornecedor de IA (${url}): ${erro?.message ?? erro}`,
    );
  }
  if (!resposta.ok) {
    throw new Error(`O fornecedor de IA devolveu HTTP ${resposta.status} (${url}).`);
  }
  let dados = null;
  try {
    dados = await resposta.json();
  } catch {
    throw new Error('O fornecedor de IA devolveu uma resposta que não é JSON.');
  }
  const texto = dados?.choices?.[0]?.message?.content;
  if (typeof texto !== 'string' || texto.trim() === '') {
    throw new Error('O fornecedor de IA devolveu uma resposta vazia.');
  }
  return validarTitulos(extrairTitulosDoTexto(texto), 'Modo real');
}

/**
 * Ponto de entrada da extensão (ver `runtime.exportacao` no manifesto).
 */
export async function executar(pedido) {
  const tema = obterTema(pedido);
  const titulos = process.env.TITULOS_API_URL
    ? await gerarTitulosReal(tema)
    : validarTitulos(gerarTitulosMock(tema), 'Modo mock');
  return { saidas: { titulos } };
}

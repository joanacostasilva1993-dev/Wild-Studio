#!/usr/bin/env node
// Licensed under the Business Source License 1.1 — see LICENSE

/**
 * Demonstração de ponta a ponta contra a API HTTP real.
 *
 * Percorre o ciclo completo do MVP:
 *   canal → métodos → projeto → execução → aprovação → entregas
 *
 * Passos:
 *  1. Cria o canal "Canal Demo" com a ordem dos 8 processos.
 *  2. Regista um método por processo (título: CRIAR + VALIDAR; restantes:
 *     um CRIAR simples).
 *  3. Cria o projeto "Episódio 1".
 *  4. Avança bloco a bloco: submete entregas de texto nos blocos CRIAR em
 *     curso e aprova o bloco VALIDAR, até o projeto ficar concluído.
 *  5. Lista as entregas e imprime um resumo.
 *
 * Requer a API a correr (ex.: `npm run dev` noutro terminal).
 * Base: `API_BASE` (por omissão `http://localhost:3000`).
 * Sai com código 1 se algum passo falhar.
 */

const BASE = (process.env.API_BASE ?? 'http://localhost:3000').replace(/\/$/, '');
const MAX_ITERACOES = 100;

const PROCESSOS = [
  'tema',
  'titulo',
  'thumbnail',
  'guiao',
  'narracao',
  'visuais',
  'edicao',
  'publicacao',
];

function falhar(mensagem) {
  console.error(`\n✗ FALHA: ${mensagem}`);
  process.exit(1);
}

/** Espera a API ficar a responder antes de começar. */
async function esperarApi(tentativas = 40) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(`${BASE}/api/canais`);
      if (r.ok) return;
    } catch {
      // Ainda a arrancar; tenta de novo.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  falhar(`a API não respondeu em ${BASE}`);
}

/** Chamada JSON à API; falha (sai 1) em erro de rede ou HTTP não-2xx. */
async function api(metodo, caminho, corpo) {
  let resposta;
  try {
    resposta = await fetch(`${BASE}${caminho}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch (erro) {
    falhar(`pedido ${metodo} ${caminho} sem resposta (${erro.message})`);
  }
  let dados = null;
  try {
    dados = await resposta.json();
  } catch {
    // Corpo vazio ou não-JSON; segue com null.
  }
  if (!resposta.ok) {
    falhar(`pedido ${metodo} ${caminho} → HTTP ${resposta.status}: ${dados?.erro ?? 'sem detalhe'}`);
  }
  return dados;
}

/** Porta de saída de texto simples (texto/um/embutido). */
function saidaTexto(chave) {
  return [
    {
      chave,
      rotulo: chave,
      tipo: {
        tipo: 'conteudo',
        familia: 'texto',
        cardinalidade: 'um',
        representacao: 'embutido',
      },
    },
  ];
}

/** Método de demonstração para cada processo (ver ESPECIFICACAO-MVP.md §3). */
function metodoPara(processo) {
  if (processo === 'titulo') {
    return {
      processo,
      blocos: [
        {
          id: 'titulo-criar',
          tipo: 'CRIAR',
          operador: 'humano',
          titulo: 'Escrever o título',
          descricao: 'Redigir o título do episódio.',
          saidas: saidaTexto('titulo'),
        },
        {
          id: 'titulo-validar',
          tipo: 'VALIDAR',
          operador: 'humano',
          titulo: 'Validar o título',
          descricao: 'Aprovação humana do título antes de prosseguir.',
        },
      ],
    };
  }
  return {
    processo,
    blocos: [
      {
        id: `${processo}-criar`,
        tipo: 'CRIAR',
        operador: 'humano',
        titulo: `Criar: ${processo}`,
      },
    ],
  };
}

async function main() {
  console.log('=== Demonstração da API local ===');
  console.log(`Base: ${BASE}\n`);

  await esperarApi();
  console.log('[1/6] API a responder.');

  console.log('[2/6] A criar o canal "Canal Demo"...');
  const canal = await api('POST', '/api/canais', { nome: 'Canal Demo', ordemProcessos: PROCESSOS });
  console.log(`      Canal criado: id=${canal.id}, nome="${canal.nome}".`);

  console.log('[3/6] A registar métodos (8 processos)...');
  for (const processo of PROCESSOS) {
    const r = await api('PUT', `/api/canais/${canal.id}/metodos`, metodoPara(processo));
    console.log(`      ${processo}: versão ${r.versao}.`);
  }

  console.log('[4/6] A criar o projeto "Episódio 1"...');
  const projeto = await api('POST', '/api/projetos', { canalId: canal.id, nome: 'Episódio 1' });
  console.log(`      Projeto criado: id=${projeto.id}.`);

  console.log('[5/6] Ciclo de execução (avançar → entregar → aprovar)...');
  let iteracao = 0;
  for (;;) {
    iteracao += 1;
    if (iteracao > MAX_ITERACOES) {
      falhar('limite de iterações excedido sem concluir o projeto');
    }
    const detalhe = await api('GET', `/api/projetos/${projeto.id}`);
    if (detalhe.projeto.estado === 'concluido') {
      console.log(`      Projeto concluído após ${iteracao - 1} iterações.`);
      break;
    }
    const blocos = detalhe.processos.flatMap((p) => p.blocos);
    const emCurso = blocos.find((b) => b.estado === 'em_curso' && b.tipo !== 'VALIDAR');
    if (emCurso) {
      const texto = `Texto de demonstração do bloco "${emCurso.titulo}" (${emCurso.processo}).`;
      await api('POST', `/api/blocos/${emCurso.id}/entrega`, { valor: texto, autor: 'demo' });
      console.log(`      [${iteracao}] entrega submetida em "${emCurso.titulo}" (${emCurso.processo}).`);
      continue;
    }
    const aValidar = blocos.find((b) => b.estado === 'aguardar_aprovacao');
    if (aValidar) {
      await api('POST', `/api/blocos/${aValidar.id}/aprovar`, {
        autor: 'demo',
        comentario: 'Aprovado na demonstração.',
      });
      console.log(`      [${iteracao}] bloco "${aValidar.titulo}" aprovado.`);
      continue;
    }
    const avanco = await api('POST', `/api/projetos/${projeto.id}/avancar`);
    console.log(`      [${iteracao}] avançar → ${JSON.stringify(avanco)}.`);
  }

  console.log('[6/6] A listar entregas...');
  const entregas = await api('GET', `/api/projetos/${projeto.id}/entregas`);

  console.log('\n=== Resumo ===');
  console.log(`Projeto "Episódio 1" (id=${projeto.id}): concluído.`);
  console.log(`Entregas: ${entregas.length}.`);
  for (const e of entregas) {
    const valor = typeof e.valor === 'string' ? e.valor : JSON.stringify(e.valor);
    console.log(`  #${e.id} bloco=${e.execBlocoId} tentativa=${e.tentativa} valor="${valor.slice(0, 80)}"`);
  }
  console.log('\n✓ Demonstração concluída com sucesso.');
}

main().catch((erro) => falhar(erro?.message ?? String(erro)));

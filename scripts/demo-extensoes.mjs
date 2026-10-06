#!/usr/bin/env node
// Licensed under the Business Source License 1.1 — see LICENSE

/**
 * Demonstração de ponta a ponta do protocolo de extensões (M2) contra a
 * API HTTP real.
 *
 * Passos:
 *  1. Instala `./extensions/referencia` → confirma `ativa: false`.
 *  2. Dá consentimento → confirma `ativa: true`.
 *  3. Cria o canal "Canal Extensões": no processo `titulo`, um bloco CRIAR
 *     `ia` (extensão de referência, `parametros: { tema }`) + VALIDAR
 *     humano; nos outros 7 processos, um CRIAR humano simples.
 *  4. Cria o projeto "Episódio IA" e executa-o: `avancar` → quando o bloco
 *     `ia` fica `em_curso`, `POST /api/jobs/executar` até haver entrega;
 *     aprova o VALIDAR; no fim verifica que existe uma entrega com 5 títulos.
 *  5. Cenário de bloqueio: segundo canal/projeto com um bloco `ia` a
 *     referenciar `extensao.inexistente`; `avancar` + `POST
 *     /api/jobs/executar` → bloco em `falhou` com diagnóstico que menciona
 *     a extensão em falta.
 *  6. Imprime um resumo.
 *
 * Requer a API a correr a partir da RAIZ do projeto (o `caminho` da
 * instalação resolve-se contra o diretório de trabalho do servidor) e com
 * o registo de extensões + executor disponíveis (módulos dos colegas).
 * Base: `API_BASE` (por omissão `http://localhost:3000`).
 * Sai com código 1 se algum passo falhar.
 */

const BASE = (process.env.API_BASE ?? 'http://localhost:3000').replace(/\/$/, '');
const MAX_ITERACOES = 120;

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

const EXT_CAMINHO = './extensions/referencia';
const EXT_ID = 'wild-studio.titulos-referencia';
const EXT_FANTASMA = 'extensao.inexistente';
const TEMA = 'como organizar a semana';

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

/**
 * Chamada JSON à API; falha (sai 1) em erro de rede ou HTTP não-2xx.
 * Para erros esperados, ver `apiEsperado`.
 */
async function api(metodo, caminho, corpo) {
  const { estado, dados } = await apiBruta(metodo, caminho, corpo);
  if (estado < 200 || estado >= 300) {
    falhar(`pedido ${metodo} ${caminho} → HTTP ${estado}: ${dados?.erro ?? 'sem detalhe'}`);
  }
  return dados;
}

/** Chamada JSON à API sem falhar: devolve `{ estado, dados }`. */
async function apiBruta(metodo, caminho, corpo) {
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
  return { estado: resposta.status, dados };
}

/** Porta de saída `titulos`: texto / varios / embutido. */
function portaTitulos() {
  return {
    chave: 'titulos',
    rotulo: 'Títulos',
    tipo: {
      tipo: 'conteudo',
      familia: 'texto',
      cardinalidade: 'varios',
      representacao: 'embutido',
    },
  };
}

/** Método para cada processo do canal principal. */
function metodoPrincipal(processo) {
  if (processo === 'titulo') {
    return {
      processo,
      blocos: [
        {
          id: 'titulo-criar-ia',
          tipo: 'CRIAR',
          operador: 'ia',
          titulo: 'Gerar títulos com IA',
          descricao: 'Gera 5 títulos com a extensão de referência.',
          extensaoId: EXT_ID,
          parametros: { tema: TEMA },
          saidas: [portaTitulos()],
        },
        {
          id: 'titulo-validar',
          tipo: 'VALIDAR',
          operador: 'humano',
          titulo: 'Validar os títulos',
          descricao: 'Aprovação humana dos títulos gerados.',
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

function todosBlocos(detalhe) {
  return detalhe.processos.flatMap((p) => p.blocos);
}

async function main() {
  console.log('=== Demonstração das extensões (M2) ===');
  console.log(`Base: ${BASE}\n`);

  await esperarApi();
  console.log('[1/8] API a responder.');

  console.log('[2/8] A instalar a extensão de referência...');
  const instalada = await api('POST', '/api/extensoes/instalar', { caminho: EXT_CAMINHO });
  if (instalada.id !== EXT_ID) {
    falhar(`id inesperado na instalação: '${instalada.id}' (esperado '${EXT_ID}')`);
  }
  if (instalada.ativa !== false) {
    falhar('a extensão devia arrancar inativa (ativa: false)');
  }
  console.log(`      Instalada: ${instalada.nome} v${instalada.versao} (ativa: false).`);
  console.log(`      Resumo para revisão: ${JSON.stringify(instalada.resumo)}`);

  console.log('[3/8] A dar consentimento...');
  const consentida = await api('POST', `/api/extensoes/${EXT_ID}/consentir`, {
    consentido: true,
    nota: 'Demonstração M2: extensão de referência, código revisto.',
  });
  if (consentida.ativa !== true) {
    falhar('a extensão devia ficar ativa após o consentimento');
  }
  console.log('      Consentimento registado (ativa: true).');

  console.log('[4/8] A criar o canal "Canal Extensões" e os métodos...');
  const canal = await api('POST', '/api/canais', {
    nome: 'Canal Extensões',
    ordemProcessos: PROCESSOS,
  });
  for (const processo of PROCESSOS) {
    await api('PUT', `/api/canais/${canal.id}/metodos`, metodoPrincipal(processo));
  }
  console.log(`      Canal id=${canal.id} com 8 métodos (titulo: CRIAR ia + VALIDAR).`);

  console.log('[5/8] A criar o projeto "Episódio IA"...');
  const projeto = await api('POST', '/api/projetos', {
    canalId: canal.id,
    nome: 'Episódio IA',
  });
  console.log(`      Projeto id=${projeto.id}.`);

  console.log('[6/8] Ciclo de execução (avançar → executar jobs → aprovar)...');
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
    const blocos = todosBlocos(detalhe);
    const falhado = blocos.find((b) => b.estado === 'falhou');
    if (falhado) {
      falhar(`o bloco "${falhado.titulo}" falhou: ${falhado.erro ?? 'sem diagnóstico'}`);
    }
    const iaEmCurso = blocos.find((b) => b.operador === 'ia' && b.estado === 'em_curso');
    if (iaEmCurso) {
      const resumo = await api('POST', '/api/jobs/executar', {});
      console.log(
        `      [${iteracao}] jobs/executar → executados=${resumo.executados} ` +
          `concluidos=${resumo.concluidos} falhados=${resumo.falhados}.`,
      );
      continue;
    }
    const humanoEmCurso = blocos.find(
      (b) => b.operador === 'humano' && b.estado === 'em_curso' && b.tipo !== 'VALIDAR',
    );
    if (humanoEmCurso) {
      await api('POST', `/api/blocos/${humanoEmCurso.id}/entrega`, {
        valor: `Texto de demonstração do bloco "${humanoEmCurso.titulo}".`,
        autor: 'demo-extensoes',
      });
      console.log(`      [${iteracao}] entrega submetida em "${humanoEmCurso.titulo}".`);
      continue;
    }
    const aValidar = blocos.find((b) => b.estado === 'aguardar_aprovacao');
    if (aValidar) {
      await api('POST', `/api/blocos/${aValidar.id}/aprovar`, {
        autor: 'demo-extensoes',
        comentario: 'Títulos aprovados na demonstração.',
      });
      console.log(`      [${iteracao}] bloco "${aValidar.titulo}" aprovado.`);
      continue;
    }
    const avanco = await api('POST', `/api/projetos/${projeto.id}/avancar`);
    console.log(`      [${iteracao}] avançar → ${JSON.stringify(avanco.acao ?? avanco)}.`);
  }

  console.log('[7/8] A verificar a entrega com os 5 títulos...');
  const entregas = await api('GET', `/api/projetos/${projeto.id}/entregas`);
  const entregaTitulos = entregas.find(
    (e) =>
      Array.isArray(e.valor) &&
      e.valor.length === 5 &&
      e.valor.every((t) => typeof t === 'string' && t.trim().length > 0),
  );
  if (!entregaTitulos) {
    falhar('não foi encontrada nenhuma entrega com os 5 títulos');
  }
  console.log('      Entrega encontrada:');
  for (const titulo of entregaTitulos.valor) {
    console.log(`        • ${titulo}`);
  }

  console.log('[8/8] Cenário de bloqueio (extensão inexistente)...');
  const ordemBloqueio = ['titulo', ...PROCESSOS.filter((p) => p !== 'titulo')];
  const canalBloqueio = await api('POST', '/api/canais', {
    nome: 'Canal Bloqueio',
    ordemProcessos: ordemBloqueio,
  });
  for (const processo of ordemBloqueio) {
    const metodo =
      processo === 'titulo'
        ? {
            processo,
            blocos: [
              {
                id: 'titulo-ia-fantasma',
                tipo: 'CRIAR',
                operador: 'ia',
                titulo: 'Gerar com extensão fantasma',
                extensaoId: EXT_FANTASMA,
                parametros: { tema: 'nada' },
                saidas: [portaTitulos()],
              },
            ],
          }
        : {
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
    await api('PUT', `/api/canais/${canalBloqueio.id}/metodos`, metodo);
  }
  const projetoBloqueio = await api('POST', '/api/projetos', {
    canalId: canalBloqueio.id,
    nome: 'Episódio Bloqueado',
  });
  await api('POST', `/api/projetos/${projetoBloqueio.id}/avancar`);
  let detalheBloqueio = await api('GET', `/api/projetos/${projetoBloqueio.id}`);
  let fantasma = todosBlocos(detalheBloqueio).find((b) => b.blocoId === 'titulo-ia-fantasma');
  if (!fantasma || fantasma.estado !== 'em_curso') {
    falhar('esperava o bloco da extensão fantasma em_curso após avançar');
  }
  await api('POST', '/api/jobs/executar', {});
  detalheBloqueio = await api('GET', `/api/projetos/${projetoBloqueio.id}`);
  fantasma = todosBlocos(detalheBloqueio).find((b) => b.blocoId === 'titulo-ia-fantasma');
  if (!fantasma || fantasma.estado !== 'falhou') {
    falhar(`esperava o bloco em 'falhou' (está em '${fantasma?.estado}')`);
  }
  if (!new RegExp(EXT_FANTASMA.replace('.', '\\.')).test(fantasma.erro ?? '')) {
    falhar(`o diagnóstico não menciona a extensão em falta: "${fantasma.erro ?? ''}"`);
  }
  console.log(`      Bloco 'falhou' com diagnóstico: "${fantasma.erro}"`);

  console.log('\n=== Resumo ===');
  console.log(`Extensão "${EXT_ID}": instalada → consentida → executada com sucesso.`);
  console.log(`Projeto "Episódio IA" (id=${projeto.id}): concluído, entrega com 5 títulos verificada.`);
  console.log(
    `Projeto "Episódio Bloqueado" (id=${projetoBloqueio.id}): bloco ia em 'falhou' ` +
      `com diagnóstico da extensão em falta (sem "fingir" sucesso).`,
  );
  console.log('\n✓ Demonstração das extensões concluída com sucesso.');
}

main().catch((erro) => falhar(erro?.message ?? String(erro)));

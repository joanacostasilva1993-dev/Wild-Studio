// Licensed under the Business Source License 1.1 — see LICENSE

/**
 * Testes do manifesto de extensão (protocolo v1).
 *
 * Cobrem: manifesto válido (com defaults aplicados), rejeição campo a
 * campo, regras estruturais (ids e chaves únicos, coerência da política
 * de dados, shapes de porta) e o resumo para consentimento.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ManifestoExtensaoSchema,
  resumirManifesto,
  validarManifesto,
  verificarManifesto,
  type ManifestoExtensao,
} from './manifest.js';

const TEXTO_UM = {
  tipo: 'conteudo',
  familia: 'texto',
  cardinalidade: 'um',
  representacao: 'embutido',
};

function capacidadeBase(sobrescrever: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'gerar-titulos',
    operador: 'ia',
    blocosCompativeis: ['CRIAR'],
    processosCompativeis: ['titulo'],
    entradas: [{ chave: 'tema', tipo: TEXTO_UM }],
    saidas: [
      {
        chave: 'titulos',
        tipo: { ...TEXTO_UM, cardinalidade: 'varios' },
      },
    ],
    efeitos: ['leitura_externa'],
    custo: { modelo: 'medido', descricao: 'por chamada' },
    politicaDados: {
      enviaParaTerceiros: true,
      fornecedores: ['fornecedor-llm'],
      descricao: 'envia o tema para gerar títulos',
    },
    ...sobrescrever,
  };
}

/** Manifesto válido, como objeto simples (ainda não validado). */
function manifestoValido(sobrescrever: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    apiVersion: '1',
    id: 'exemplo.titulos-ia',
    nome: 'Títulos IA',
    versao: '0.1.0',
    autor: 'Wild Studio',
    licenca: 'BSL-1.1',
    runtime: { tipo: 'modulo', entrada: 'mao.js', exportacao: 'executar' },
    capacidades: [capacidadeBase()],
    ...sobrescrever,
  };
}

describe('validarManifesto', () => {
  it('aceita um manifesto válido e devolve o objeto tipado', () => {
    const m = validarManifesto(manifestoValido());
    assert.equal(m.id, 'exemplo.titulos-ia');
    assert.equal(m.nome, 'Títulos IA');
    assert.equal(m.versao, '0.1.0');
    assert.equal(m.runtime.tipo, 'modulo');
    assert.equal(m.capacidades.length, 1);
    assert.equal(m.capacidades[0].operador, 'ia');
  });

  it('aplica defaults: entradas, efeitos e fornecedores vazios', () => {
    const m = validarManifesto(
      manifestoValido({
        capacidades: [
          capacidadeBase({
            entradas: undefined,
            efeitos: undefined,
            politicaDados: { enviaParaTerceiros: false },
          }),
        ],
      }),
    );
    assert.deepEqual(m.capacidades[0].entradas, []);
    assert.deepEqual(m.capacidades[0].efeitos, []);
    assert.deepEqual(m.capacidades[0].politicaDados.fornecedores, []);
  });

  it('rejeita apiVersion diferente de "1"', () => {
    assert.throws(() => validarManifesto(manifestoValido({ apiVersion: '2' })), /apiVersion/);
  });

  it('rejeita ids fora do formato (maiúsculas, espaços, a começar por símbolo)', () => {
    for (const id of ['Exemplo.Titulos', 'exemplo titulos', '-exemplo', 'a', 'x'.repeat(64)]) {
      assert.throws(() => validarManifesto(manifestoValido({ id })), /id/, `id '${id}' devia falhar`);
    }
    // Ids válidos nos limites: 2 carateres e 63 carateres, com . _ -.
    validarManifesto(manifestoValido({ id: 'a0' }));
    validarManifesto(manifestoValido({ id: `a${'b'.repeat(59)}._-` }));
  });

  it('rejeita nome, autor e licença vazios', () => {
    assert.throws(() => validarManifesto(manifestoValido({ nome: '' })), /nome/);
    assert.throws(() => validarManifesto(manifestoValido({ autor: '' })), /autor/);
    assert.throws(() => validarManifesto(manifestoValido({ licenca: '' })), /licença/);
  });

  it('rejeita versões fora do formato X.Y.Z', () => {
    for (const versao of ['1.0', '1', 'v1.2.3', '1.2.3.4', '1.2.x']) {
      assert.throws(() => validarManifesto(manifestoValido({ versao })), /versão/, `versão '${versao}' devia falhar`);
    }
  });

  it('rejeita runtime incompleto ou de tipo desconhecido', () => {
    assert.throws(
      () => validarManifesto(manifestoValido({ runtime: { tipo: 'modulo', entrada: '', exportacao: 'executar' } })),
      /entrada/,
    );
    assert.throws(
      () => validarManifesto(manifestoValido({ runtime: { tipo: 'modulo', entrada: 'mao.js', exportacao: '' } })),
      /exportação/,
    );
    assert.throws(
      () => validarManifesto(manifestoValido({ runtime: { tipo: 'contentor', entrada: 'mao.js', exportacao: 'executar' } })),
      /runtime/,
    );
  });

  it('rejeita manifesto sem capacidades', () => {
    assert.throws(() => validarManifesto(manifestoValido({ capacidades: [] })), /capacidade/);
    assert.throws(
      () => validarManifesto(manifestoValido({ capacidades: undefined })),
      /Required|pelo menos uma capacidade/,
    );
  });

  it('rejeita capacidade com operador, blocos ou processos inválidos', () => {
    assert.throws(
      () => validarManifesto(manifestoValido({ capacidades: [capacidadeBase({ operador: 'humano' })] })),
      /operador|ia.*codigo/i,
    );
    assert.throws(
      () => validarManifesto(manifestoValido({ capacidades: [capacidadeBase({ blocosCompativeis: [] })] })),
      /bloco compatível/,
    );
    assert.throws(
      () => validarManifesto(manifestoValido({ capacidades: [capacidadeBase({ processosCompativeis: [] })] })),
      /processo compatível/,
    );
    assert.throws(
      () => validarManifesto(manifestoValido({ capacidades: [capacidadeBase({ processosCompativeis: ['ideia'] })] })),
      /tema.*titulo/,
    );
  });

  it('rejeita capacidade sem portas de saída', () => {
    assert.throws(
      () => validarManifesto(manifestoValido({ capacidades: [capacidadeBase({ saidas: [] })] })),
      /saída/,
    );
  });

  it('rejeita efeitos desconhecidos', () => {
    assert.throws(
      () => validarManifesto(manifestoValido({ capacidades: [capacidadeBase({ efeitos: ['voar'] })] })),
      /leitura_externa/,
    );
  });

  it('rejeita shape de porta inválida (selecao sem opcoes)', () => {
    const portaMá = {
      chave: 'tom',
      tipo: { tipo: 'controlo', controlo: 'selecao', cardinalidade: 'um' },
    };
    assert.throws(
      () => validarManifesto(manifestoValido({ capacidades: [capacidadeBase({ saidas: [portaMá] })] })),
      /opcoes|opções/,
    );
  });

  it('rejeita valores que não são objetos', () => {
    assert.throws(() => validarManifesto(null), /inválido/);
    assert.throws(() => validarManifesto('extensao.json'), /inválido/);
    assert.throws(() => validarManifesto([]), /inválido/);
  });
});

describe('verificarManifesto (regras estruturais)', () => {
  it('devolve lista vazia para manifesto válido', () => {
    assert.deepEqual(verificarManifesto(validarManifesto(manifestoValido())), []);
  });

  it('deteta ids de capacidade duplicados', () => {
    const m = validarManifestoSemEstruturais(
      manifestoValido({
        capacidades: [capacidadeBase(), capacidadeBase({ operador: 'codigo' })],
      }),
    );
    const erros = verificarManifesto(m);
    assert.ok(erros.some((e) => e.includes("id duplicado") && e.includes('gerar-titulos')), erros.join('\n'));
  });

  it('deteta chaves de porta duplicadas dentro de entradas e dentro de saidas', () => {
    const duasEntradas = [
      { chave: 'tema', tipo: TEXTO_UM },
      { chave: 'tema', tipo: TEXTO_UM },
    ];
    const m1 = validarManifestoSemEstruturais(
      manifestoValido({ capacidades: [capacidadeBase({ entradas: duasEntradas })] }),
    );
    const e1 = verificarManifesto(m1);
    assert.ok(e1.some((e) => e.includes('entradas') && e.includes("'tema'")), e1.join('\n'));

    const duasSaidas = [
      { chave: 'titulos', tipo: { ...TEXTO_UM, cardinalidade: 'varios' } },
      { chave: 'titulos', tipo: { ...TEXTO_UM, cardinalidade: 'varios' } },
    ];
    const m2 = validarManifestoSemEstruturais(
      manifestoValido({ capacidades: [capacidadeBase({ saidas: duasSaidas })] }),
    );
    const e2 = verificarManifesto(m2);
    assert.ok(e2.some((e) => e.includes('saidas') && e.includes("'titulos'")), e2.join('\n'));
  });

  it('permite a mesma chave em entradas e em saidas (âmbitos separados)', () => {
    const m = validarManifesto(
      manifestoValido({
        capacidades: [
          capacidadeBase({
            entradas: [{ chave: 'texto', tipo: TEXTO_UM }],
            saidas: [{ chave: 'texto', tipo: { ...TEXTO_UM, cardinalidade: 'varios' } }],
          }),
        ],
      }),
    );
    assert.deepEqual(verificarManifesto(m), []);
  });

  it('rejeita fornecedores listados quando enviaParaTerceiros é false', () => {
    const m = validarManifestoSemEstruturais(
      manifestoValido({
        capacidades: [
          capacidadeBase({
            politicaDados: { enviaParaTerceiros: false, fornecedores: ['fornecedor-x'] },
          }),
        ],
      }),
    );
    const erros = verificarManifesto(m);
    assert.ok(erros.some((e) => e.includes('enviaParaTerceiros') && e.includes('fornecedores')), erros.join('\n'));
  });

  it('aceita enviaParaTerceiros=false com fornecedores vazio e true com fornecedores', () => {
    const m = validarManifesto(
      manifestoValido({
        capacidades: [
          capacidadeBase({ politicaDados: { enviaParaTerceiros: false, fornecedores: [] } }),
        ],
      }),
    );
    assert.deepEqual(verificarManifesto(m), []);
  });

  it('validarManifesto lança com as regras estruturais incluídas', () => {
    assert.throws(
      () =>
        validarManifesto(
          manifestoValido({
            capacidades: [capacidadeBase(), capacidadeBase({ operador: 'codigo' })],
          }),
        ),
      /id duplicado/,
    );
  });
});

describe('resumirManifesto', () => {
  it('extrai identidade, capacidades, efeitos, custo e política de dados', () => {
    const m = validarManifesto(manifestoValido());
    const r = resumirManifesto(m);
    assert.equal(r.id, 'exemplo.titulos-ia');
    assert.equal(r.nome, 'Títulos IA');
    assert.equal(r.versao, '0.1.0');
    assert.equal(r.autor, 'Wild Studio');
    assert.equal(r.licenca, 'BSL-1.1');
    assert.equal(r.capacidades.length, 1);
    const c = r.capacidades[0];
    assert.equal(c.id, 'gerar-titulos');
    assert.equal(c.operador, 'ia');
    assert.deepEqual(c.blocosCompativeis, ['CRIAR']);
    assert.deepEqual(c.processosCompativeis, ['titulo']);
    assert.deepEqual(c.efeitos, ['leitura_externa']);
    assert.deepEqual(c.custo, { modelo: 'medido', descricao: 'por chamada' });
    assert.equal(c.politicaDados.enviaParaTerceiros, true);
    assert.deepEqual(c.politicaDados.fornecedores, ['fornecedor-llm']);
    // Não inclui portas nem runtime: o resumo é para consentimento, não execução.
    assert.ok(!('entradas' in c));
    assert.ok(!('runtime' in r));
  });

  it('devolve cópias: mexer no resumo não altera o manifesto', () => {
    const m = validarManifesto(manifestoValido());
    const r = resumirManifesto(m);
    r.capacidades[0].politicaDados.fornecedores.push('intruso');
    assert.deepEqual(m.capacidades[0].politicaDados.fornecedores, ['fornecedor-llm']);
  });
});

/**
 * Valida só a forma (zod), sem as regras estruturais — para testar
 * `verificarManifesto` isoladamente sobre manifestos estruturalmente
 * inválidos mas formalmente bem formados.
 */
function validarManifestoSemEstruturais(desconhecido: unknown): ManifestoExtensao {
  const resultado = ManifestoExtensaoSchema.safeParse(desconhecido);
  if (!resultado.success) {
    throw new Error('Forma do manifesto inválida no helper de teste.');
  }
  return resultado.data;
}

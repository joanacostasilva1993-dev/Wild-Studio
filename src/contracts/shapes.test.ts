// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * Testes dos contratos de shapes: conteúdo, controlos, registos,
 * compatibilidade entre portas e validação de valores.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ContentShapeSchema,
  ControlShapeSchema,
  RecordShapeSchema,
  ValueShapeSchema,
  PortaSchema,
  compativel,
  validarValor,
} from './shapes.js';
import type {
  Porta,
  ValueShape,
  ContentShape,
  ControlShape,
  RecordShape,
} from './shapes.js';

function porta(chave: string, tipo: ValueShape, obrigatoria = true): Porta {
  return { chave, tipo, obrigatoria };
}

function conteudo(
  familia: ContentShape['familia'],
  cardinalidade: ContentShape['cardinalidade'] = 'um',
  representacao: ContentShape['representacao'] = 'embutido',
  formatos?: ContentShape['formatos'],
): ContentShape {
  return { tipo: 'conteudo', familia, cardinalidade, representacao, formatos };
}

function controlo(
  controlo: ControlShape['controlo'],
  cardinalidade: ControlShape['cardinalidade'] = 'um',
  opcoes?: string[],
): ControlShape {
  return { tipo: 'controlo', controlo, cardinalidade, opcoes };
}

// ── Schemas de conteúdo ────────────────────────────────────────────

describe('ContentShapeSchema', () => {
  it('aceita texto embutido/um válido', () => {
    const r = ContentShapeSchema.safeParse(conteudo('texto'));
    assert.equal(r.success, true);
  });

  it('aceita as 4 famílias × 2 cardinalidades × 3 representações', () => {
    const familias = ['texto', 'imagem', 'audio', 'video'] as const;
    const cards = ['um', 'varios'] as const;
    const reps = ['embutido', 'artefacto', 'ambos'] as const;
    for (const f of familias)
      for (const c of cards)
        for (const r of reps) {
          const res = ContentShapeSchema.safeParse(conteudo(f, c, r));
          assert.equal(res.success, true, `${f}/${c}/${r}`);
        }
  });

  it('aceita imagem artefacto com formatos', () => {
    const r = ContentShapeSchema.safeParse(
      conteudo('imagem', 'um', 'artefacto', { mimeTypes: ['image/png'], extensoes: ['png'] }),
    );
    assert.equal(r.success, true);
  });

  it('rejeita família desconhecida', () => {
    const r = ContentShapeSchema.safeParse({ ...conteudo('texto'), familia: 'pdf' });
    assert.equal(r.success, false);
  });

  it('rejeita cardinalidade desconhecida', () => {
    const r = ContentShapeSchema.safeParse({ ...conteudo('texto'), cardinalidade: 'muito' });
    assert.equal(r.success, false);
  });
});

// ── Schemas de controlo ────────────────────────────────────────────

describe('ControlShapeSchema', () => {
  const controlos = [
    'identificador',
    'numero',
    'booleano',
    'datahora',
    'url',
    'aprovacao',
  ] as const;

  for (const c of controlos) {
    it(`aceita controlo '${c}' sem opcoes`, () => {
      const r = ControlShapeSchema.safeParse(controlo(c));
      assert.equal(r.success, true);
    });
  }

  it("aceita 'selecao' com opcoes não vazias", () => {
    const r = ControlShapeSchema.safeParse(controlo('selecao', 'um', ['a', 'b']));
    assert.equal(r.success, true);
  });

  it("rejeita 'selecao' sem opcoes", () => {
    const r = ControlShapeSchema.safeParse(controlo('selecao'));
    assert.equal(r.success, false);
  });

  it("rejeita 'selecao' com opcoes vazias", () => {
    const r = ControlShapeSchema.safeParse(controlo('selecao', 'um', []));
    assert.equal(r.success, false);
  });
});

// ── Schemas de registo ─────────────────────────────────────────────

describe('RecordShapeSchema', () => {
  it('aceita registo simples válido', () => {
    const shape: RecordShape = {
      tipo: 'registo',
      cardinalidade: 'um',
      campos: [
        { id: 'c1', rotulo: 'Título', chave: 'titulo', tipo: conteudo('texto'), obrigatorio: true },
        { id: 'c2', rotulo: 'Nota', chave: 'nota', tipo: controlo('numero'), obrigatorio: false },
      ],
    };
    assert.equal(RecordShapeSchema.safeParse(shape).success, true);
  });

  it('aceita registo aninhado (campo cujo tipo é registo)', () => {
    const interno: RecordShape = {
      tipo: 'registo',
      cardinalidade: 'um',
      campos: [
        { id: 'd1', rotulo: 'URL', chave: 'url', tipo: controlo('url'), obrigatorio: true },
      ],
    };
    const externo: RecordShape = {
      tipo: 'registo',
      cardinalidade: 'um',
      campos: [
        { id: 'e1', rotulo: 'Anexo', chave: 'anexo', tipo: interno, obrigatorio: true },
      ],
    };
    assert.equal(RecordShapeSchema.safeParse(externo).success, true);
  });

  it('rejeita campo sem chave', () => {
    const shape = {
      tipo: 'registo',
      cardinalidade: 'um',
      campos: [{ id: 'c1', rotulo: 'X', tipo: conteudo('texto'), obrigatorio: true }],
    };
    assert.equal(RecordShapeSchema.safeParse(shape).success, false);
  });

  it('rejeita registo sem campos', () => {
    const shape = { tipo: 'registo', cardinalidade: 'um', campos: [] };
    assert.equal(RecordShapeSchema.safeParse(shape).success, false);
  });
});

// ── União discriminada ─────────────────────────────────────────────

describe('ValueShapeSchema', () => {
  it('discrimina as três variantes por tipo', () => {
    assert.equal(ValueShapeSchema.safeParse(conteudo('video', 'um', 'artefacto')).success, true);
    assert.equal(ValueShapeSchema.safeParse(controlo('booleano')).success, true);
    assert.equal(
      ValueShapeSchema.safeParse({
        tipo: 'registo',
        cardinalidade: 'um',
        campos: [{ id: 'c1', rotulo: 'A', chave: 'a', tipo: controlo('numero'), obrigatorio: true }],
      }).success,
      true,
    );
  });

  it('rejeita tipo desconhecido', () => {
    assert.equal(ValueShapeSchema.safeParse({ tipo: 'tabela', cardinalidade: 'um' }).success, false);
  });
});

// ── Porta ──────────────────────────────────────────────────────────

describe('PortaSchema', () => {
  it('aplica default obrigatoria=true', () => {
    const r = PortaSchema.safeParse({ chave: 'titulo', tipo: conteudo('texto') });
    assert.equal(r.success, true);
    if (r.success) assert.equal(r.data.obrigatoria, true);
  });

  it('rejeita chave vazia', () => {
    const r = PortaSchema.safeParse({ chave: '', tipo: conteudo('texto') });
    assert.equal(r.success, false);
  });

  it("rejeita porta com 'selecao' sem opcoes (regra estrutural)", () => {
    // O refinamento vive em PortaSchema porque o zod não permite
    // refinamentos em membros de discriminatedUnion.
    const r = PortaSchema.safeParse({ chave: 'cor', tipo: controlo('selecao') });
    assert.equal(r.success, false);
  });

  it('rejeita registo com chaves de campo duplicadas', () => {
    const r = PortaSchema.safeParse({
      chave: 'meta',
      tipo: {
        tipo: 'registo',
        cardinalidade: 'um',
        campos: [
          { id: 'c1', rotulo: 'A', chave: 'a', tipo: controlo('numero'), obrigatorio: true },
          { id: 'c2', rotulo: 'B', chave: 'a', tipo: controlo('numero'), obrigatorio: false },
        ],
      } satisfies RecordShape,
    });
    assert.equal(r.success, false);
  });
});

// ── Compatibilidade ────────────────────────────────────────────────

describe('compativel', () => {
  it('verdadeiro: shapes de conteúdo idênticas', () => {
    assert.equal(
      compativel(porta('s', conteudo('texto')), porta('e', conteudo('texto'))),
      true,
    );
  });

  it("verdadeiro: 'ambos' compatível com 'embutido' (nos dois sentidos)", () => {
    const ambos = porta('s', conteudo('texto', 'um', 'ambos'));
    const emb = porta('e', conteudo('texto', 'um', 'embutido'));
    assert.equal(compativel(ambos, emb), true);
    assert.equal(compativel(emb, ambos), true);
  });

  it('falso: famílias diferentes', () => {
    assert.equal(
      compativel(porta('s', conteudo('texto')), porta('e', conteudo('imagem', 'um', 'artefacto'))),
      false,
    );
  });

  it('falso: cardinalidades diferentes', () => {
    assert.equal(
      compativel(porta('s', conteudo('texto', 'varios')), porta('e', conteudo('texto', 'um'))),
      false,
    );
  });

  it('falso: tipo raiz diferente (conteudo vs controlo)', () => {
    assert.equal(
      compativel(porta('s', conteudo('texto')), porta('e', controlo('identificador'))),
      false,
    );
  });

  it("falso: representacao 'embutido' vs 'artefacto'", () => {
    assert.equal(
      compativel(
        porta('s', conteudo('texto', 'um', 'embutido')),
        porta('e', conteudo('texto', 'um', 'artefacto')),
      ),
      false,
    );
  });

  it('verdadeiro: formatos com interseção em mimeTypes', () => {
    const s = porta('s', conteudo('imagem', 'um', 'artefacto', { mimeTypes: ['image/png', 'image/jpeg'] }));
    const e = porta('e', conteudo('imagem', 'um', 'artefacto', { mimeTypes: ['image/jpeg'] }));
    assert.equal(compativel(s, e), true);
  });

  it('verdadeiro: formatos com interseção em extensoes (tolerante a maiúsculas e ponto)', () => {
    const s = porta('s', conteudo('imagem', 'um', 'artefacto', { extensoes: ['PNG'] }));
    const e = porta('e', conteudo('imagem', 'um', 'artefacto', { extensoes: ['.png'] }));
    assert.equal(compativel(s, e), true);
  });

  it('falso: formatos sem interseção', () => {
    const s = porta('s', conteudo('imagem', 'um', 'artefacto', { mimeTypes: ['image/png'] }));
    const e = porta('e', conteudo('imagem', 'um', 'artefacto', { mimeTypes: ['image/jpeg'] }));
    assert.equal(compativel(s, e), false);
  });

  it('verdadeiro: só um lado declara formatos (sem restrição)', () => {
    const s = porta('s', conteudo('imagem', 'um', 'artefacto', { mimeTypes: ['image/png'] }));
    const e = porta('e', conteudo('imagem', 'um', 'artefacto'));
    assert.equal(compativel(s, e), true);
    assert.equal(compativel(e, s), true);
  });

  it('falso: sem coerção implícita (numero vs texto)', () => {
    assert.equal(
      compativel(porta('s', controlo('numero')), porta('e', conteudo('texto'))),
      false,
    );
  });

  it('verdadeiro: controlos iguais', () => {
    assert.equal(
      compativel(porta('s', controlo('numero')), porta('e', controlo('numero'))),
      true,
    );
  });

  it('falso: controlos diferentes', () => {
    assert.equal(
      compativel(porta('s', controlo('numero')), porta('e', controlo('booleano'))),
      false,
    );
  });

  it("verdadeiro: 'selecao' em que a entrada só usa opções da saída", () => {
    const s = porta('s', controlo('selecao', 'um', ['a', 'b', 'c']));
    const e = porta('e', controlo('selecao', 'um', ['a', 'c']));
    assert.equal(compativel(s, e), true);
  });

  it("falso: 'selecao' em que a entrada exige opção fora da saída", () => {
    const s = porta('s', controlo('selecao', 'um', ['a', 'b']));
    const e = porta('e', controlo('selecao', 'um', ['a', 'z']));
    assert.equal(compativel(s, e), false);
  });

  it('verdadeiro: registo em que a saída tem campos extra', () => {
    const shapeSaida: RecordShape = {
      tipo: 'registo',
      cardinalidade: 'um',
      campos: [
        { id: 'c1', rotulo: 'Título', chave: 'titulo', tipo: conteudo('texto'), obrigatorio: true },
        { id: 'c2', rotulo: 'Extra', chave: 'extra', tipo: controlo('numero'), obrigatorio: false },
      ],
    };
    const shapeEntrada: RecordShape = {
      tipo: 'registo',
      cardinalidade: 'um',
      campos: [
        { id: 'c1', rotulo: 'Título', chave: 'titulo', tipo: conteudo('texto'), obrigatorio: true },
      ],
    };
    assert.equal(compativel(porta('s', shapeSaida), porta('e', shapeEntrada)), true);
  });

  it('verdadeiro: campo opcional da entrada pode faltar na saída', () => {
    const shapeSaida: RecordShape = {
      tipo: 'registo',
      cardinalidade: 'um',
      campos: [
        { id: 'c1', rotulo: 'Título', chave: 'titulo', tipo: conteudo('texto'), obrigatorio: true },
      ],
    };
    const shapeEntrada: RecordShape = {
      tipo: 'registo',
      cardinalidade: 'um',
      campos: [
        { id: 'c1', rotulo: 'Título', chave: 'titulo', tipo: conteudo('texto'), obrigatorio: true },
        { id: 'c2', rotulo: 'Nota', chave: 'nota', tipo: controlo('numero'), obrigatorio: false },
      ],
    };
    assert.equal(compativel(porta('s', shapeSaida), porta('e', shapeEntrada)), true);
  });

  it('falso: registo sem campo obrigatório da entrada', () => {
    const shapeSaida: RecordShape = {
      tipo: 'registo',
      cardinalidade: 'um',
      campos: [
        { id: 'c1', rotulo: 'Título', chave: 'titulo', tipo: conteudo('texto'), obrigatorio: true },
      ],
    };
    const shapeEntrada: RecordShape = {
      tipo: 'registo',
      cardinalidade: 'um',
      campos: [
        { id: 'c1', rotulo: 'Título', chave: 'titulo', tipo: conteudo('texto'), obrigatorio: true },
        { id: 'c2', rotulo: 'URL', chave: 'url', tipo: controlo('url'), obrigatorio: true },
      ],
    };
    assert.equal(compativel(porta('s', shapeSaida), porta('e', shapeEntrada)), false);
  });

  it('falso: registo com campo de tipo incompatível', () => {
    const shapeSaida: RecordShape = {
      tipo: 'registo',
      cardinalidade: 'um',
      campos: [
        { id: 'c1', rotulo: 'Título', chave: 'titulo', tipo: controlo('numero'), obrigatorio: true },
      ],
    };
    const shapeEntrada: RecordShape = {
      tipo: 'registo',
      cardinalidade: 'um',
      campos: [
        { id: 'c1', rotulo: 'Título', chave: 'titulo', tipo: conteudo('texto'), obrigatorio: true },
      ],
    };
    assert.equal(compativel(porta('s', shapeSaida), porta('e', shapeEntrada)), false);
  });

  it('verdadeiro/falso: registo aninhado compatível (recursivo)', () => {
    const interno: RecordShape = {
      tipo: 'registo',
      cardinalidade: 'um',
      campos: [
        { id: 'd1', rotulo: 'URL', chave: 'url', tipo: controlo('url'), obrigatorio: true },
      ],
    };
    const saida: RecordShape = {
      tipo: 'registo',
      cardinalidade: 'um',
      campos: [
        { id: 'e1', rotulo: 'Anexo', chave: 'anexo', tipo: interno, obrigatorio: true },
      ],
    };
    const entradaOk: RecordShape = {
      tipo: 'registo',
      cardinalidade: 'um',
      campos: [
        { id: 'e1', rotulo: 'Anexo', chave: 'anexo', tipo: interno, obrigatorio: true },
      ],
    };
    const internoMau: RecordShape = {
      tipo: 'registo',
      cardinalidade: 'um',
      campos: [
        { id: 'd1', rotulo: 'URL', chave: 'url', tipo: controlo('numero'), obrigatorio: true },
      ],
    };
    const entradaMa: RecordShape = {
      tipo: 'registo',
      cardinalidade: 'um',
      campos: [
        { id: 'e1', rotulo: 'Anexo', chave: 'anexo', tipo: internoMau, obrigatorio: true },
      ],
    };
    assert.equal(compativel(porta('s', saida), porta('e', entradaOk)), true);
    assert.equal(compativel(porta('s', saida), porta('e', entradaMa)), false);
  });
});

// ── Validação de valores ───────────────────────────────────────────

describe('validarValor — conteúdo', () => {
  it("texto embutido/um: string válida, número inválido", () => {
    assert.deepEqual(validarValor(conteudo('texto'), 'olá'), []);
    assert.equal(validarValor(conteudo('texto'), 42).length > 0, true);
    assert.equal(validarValor(conteudo('texto'), ['a']).length > 0, true);
  });

  it('texto embutido/varios: lista de strings válida', () => {
    assert.deepEqual(validarValor(conteudo('texto', 'varios'), ['a', 'b']), []);
    assert.equal(validarValor(conteudo('texto', 'varios'), 'solta').length > 0, true);
    const erros = validarValor(conteudo('texto', 'varios'), ['a', 3]);
    assert.equal(erros.length > 0, true);
    assert.match(erros[0], /\[1\]/);
  });

  it('texto artefacto: { id } válido, string inválida', () => {
    const shape = conteudo('texto', 'um', 'artefacto');
    assert.deepEqual(validarValor(shape, { id: 'abc123' }), []);
    assert.equal(validarValor(shape, 'texto solto').length > 0, true);
    assert.equal(validarValor(shape, { id: '' }).length > 0, true);
    assert.equal(validarValor(shape, {}).length > 0, true);
  });

  it("texto 'ambos': aceita string e { id }, rejeita número", () => {
    const shape = conteudo('texto', 'um', 'ambos');
    assert.deepEqual(validarValor(shape, 'embutido'), []);
    assert.deepEqual(validarValor(shape, { id: 'f1' }), []);
    assert.equal(validarValor(shape, 42).length > 0, true);
  });

  it('imagem: { id } válido; string e { id: "" } inválidos', () => {
    const shape = conteudo('imagem', 'um', 'artefacto');
    assert.deepEqual(validarValor(shape, { id: 'img-1' }), []);
    assert.equal(validarValor(shape, 'img-1').length > 0, true);
    assert.equal(validarValor(shape, { id: '' }).length > 0, true);
    assert.equal(validarValor(shape, null).length > 0, true);
  });

  it('imagem/varios: lista de { id } válida', () => {
    const shape = conteudo('imagem', 'varios', 'artefacto');
    assert.deepEqual(validarValor(shape, [{ id: 'a' }, { id: 'b' }]), []);
    assert.equal(validarValor(shape, [{ id: 'a' }, { noid: 1 }]).length > 0, true);
  });

  it('formatos: valida extensão/mime só quando o valor declara', () => {
    const shape = conteudo('imagem', 'um', 'artefacto', {
      mimeTypes: ['image/png'],
      extensoes: ['png'],
    });
    // Dentro da lista: ok.
    assert.deepEqual(validarValor(shape, { id: 'a', extensao: 'png' }), []);
    assert.deepEqual(validarValor(shape, { id: 'a', extensao: '.PNG' }), []);
    assert.deepEqual(validarValor(shape, { id: 'a', mimeType: 'IMAGE/PNG' }), []);
    // Fora da lista: erro.
    assert.equal(validarValor(shape, { id: 'a', extensao: 'jpg' }).length > 0, true);
    assert.equal(validarValor(shape, { id: 'a', mimeType: 'image/jpeg' }).length > 0, true);
    // Sem declaração no valor: tolerante, sem erro.
    assert.deepEqual(validarValor(shape, { id: 'a' }), []);
  });
});

describe('validarValor — controlos', () => {
  it('numero: finito ok; NaN, infinito e texto rejeitados (sem coerção)', () => {
    assert.deepEqual(validarValor(controlo('numero'), 3.5), []);
    assert.equal(validarValor(controlo('numero'), Number.NaN).length > 0, true);
    assert.equal(validarValor(controlo('numero'), Number.POSITIVE_INFINITY).length > 0, true);
    assert.equal(validarValor(controlo('numero'), '3').length > 0, true);
  });

  it('numero/varios: lista válida; elemento inválido com caminho', () => {
    assert.deepEqual(validarValor(controlo('numero', 'varios'), [1, 2]), []);
    const erros = validarValor(controlo('numero', 'varios'), [1, 'x']);
    assert.equal(erros.length > 0, true);
    assert.match(erros[0], /\[1\]/);
  });

  it('booleano: true/false ok; 1 rejeitado', () => {
    assert.deepEqual(validarValor(controlo('booleano'), true), []);
    assert.deepEqual(validarValor(controlo('booleano'), false), []);
    assert.equal(validarValor(controlo('booleano'), 1).length > 0, true);
  });

  it('identificador: texto não vazio ok; vazio rejeitado', () => {
    assert.deepEqual(validarValor(controlo('identificador'), 'abc-123'), []);
    assert.equal(validarValor(controlo('identificador'), '').length > 0, true);
  });

  it('url: texto não vazio ok; vazio rejeitado', () => {
    assert.deepEqual(validarValor(controlo('url'), 'https://exemplo.pt'), []);
    assert.equal(validarValor(controlo('url'), '').length > 0, true);
  });

  it('datahora: ISO válida ok; texto livre rejeitado', () => {
    assert.deepEqual(validarValor(controlo('datahora'), '2026-10-06T10:00:00Z'), []);
    assert.deepEqual(validarValor(controlo('datahora'), '2026-10-06'), []);
    assert.equal(validarValor(controlo('datahora'), 'ontem').length > 0, true);
    assert.equal(validarValor(controlo('datahora'), '').length > 0, true);
  });

  it('selecao: opção da lista ok; fora da lista rejeitado', () => {
    const shape = controlo('selecao', 'um', ['curto', 'longo']);
    assert.deepEqual(validarValor(shape, 'curto'), []);
    assert.equal(validarValor(shape, 'medio').length > 0, true);
    assert.equal(validarValor(shape, 1).length > 0, true);
  });

  it('aprovacao: vereditos válidos e inválidos', () => {
    const shape = controlo('aprovacao');
    assert.deepEqual(validarValor(shape, { decisao: 'aprovado' }), []);
    assert.deepEqual(validarValor(shape, { decisao: 'rejeitado', comentario: 'não gostei' }), []);
    assert.equal(validarValor(shape, { decisao: 'talvez' }).length > 0, true);
    assert.equal(validarValor(shape, {}).length > 0, true);
    assert.equal(validarValor(shape, { decisao: 'aprovado', comentario: 5 }).length > 0, true);
    assert.equal(validarValor(shape, true).length > 0, true);
  });
});

describe('validarValor — registos', () => {
  const shape: RecordShape = {
    tipo: 'registo',
    cardinalidade: 'um',
    campos: [
      { id: 'c1', rotulo: 'Título', chave: 'titulo', tipo: conteudo('texto'), obrigatorio: true },
      { id: 'c2', rotulo: 'Duração', chave: 'duracao', tipo: controlo('numero'), obrigatorio: false },
    ],
  };

  it('objeto válido sem erros', () => {
    assert.deepEqual(validarValor(shape, { titulo: 'Olá', duracao: 12 }), []);
  });

  it('campo obrigatório em falta → erro', () => {
    const erros = validarValor(shape, { duracao: 12 });
    assert.equal(erros.length > 0, true);
    assert.match(erros[0], /titulo/);
  });

  it('campo opcional em falta → sem erro', () => {
    assert.deepEqual(validarValor(shape, { titulo: 'Olá' }), []);
  });

  it('campo com valor inválido → erro recursivo com caminho', () => {
    const erros = validarValor(shape, { titulo: 'Olá', duracao: 'doze' });
    assert.equal(erros.length > 0, true);
    assert.match(erros[0], /duracao/);
  });

  it('não-objeto → erro', () => {
    assert.equal(validarValor(shape, 'texto').length > 0, true);
    assert.equal(validarValor(shape, null).length > 0, true);
  });

  it('registo aninhado: válido e inválido', () => {
    const externo: RecordShape = {
      tipo: 'registo',
      cardinalidade: 'um',
      campos: [
        { id: 'e1', rotulo: 'Meta', chave: 'meta', tipo: shape, obrigatorio: true },
      ],
    };
    assert.deepEqual(validarValor(externo, { meta: { titulo: 'X' } }), []);
    const erros = validarValor(externo, { meta: { duracao: 1 } });
    assert.equal(erros.length > 0, true);
    assert.match(erros[0], /meta/);
    assert.match(erros[0], /titulo/);
  });

  it('registo/varios: lista válida; elemento inválido com índice', () => {
    const varios: RecordShape = { ...shape, cardinalidade: 'varios' };
    assert.deepEqual(validarValor(varios, [{ titulo: 'A' }, { titulo: 'B' }]), []);
    const erros = validarValor(varios, [{ titulo: 'A' }, { duracao: 1 }]);
    assert.equal(erros.length > 0, true);
    assert.match(erros[0], /\[1\]/);
    assert.equal(validarValor(varios, { titulo: 'A' }).length > 0, true);
  });
});

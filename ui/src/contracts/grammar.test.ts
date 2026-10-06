// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * Testes da gramática do método: processos, blocos, operadores,
 * regras de composição e validação de canais.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROCESSOS,
  ProcessoIdSchema,
  BlocoTipoSchema,
  OperadorSchema,
  BlocoDefSchema,
  MetodoDefSchema,
  CanalDefSchema,
  validarCanal,
} from './grammar.js';
import type { ProcessoId } from './grammar.js';

// ── Vocabulário ────────────────────────────────────────────────────

describe('vocabulário', () => {
  it('PROCESSOS tem exatamente os 8 processos', () => {
    assert.deepEqual([...PROCESSOS], [
      'tema',
      'titulo',
      'thumbnail',
      'guiao',
      'narracao',
      'visuais',
      'edicao',
      'publicacao',
    ]);
  });

  it('ProcessoIdSchema aceita os 8 e rejeita desconhecidos', () => {
    for (const p of PROCESSOS) assert.equal(ProcessoIdSchema.safeParse(p).success, true);
    assert.equal(ProcessoIdSchema.safeParse('título').success, false);
    assert.equal(ProcessoIdSchema.safeParse('TEMA').success, false);
  });

  it('BlocoTipoSchema aceita os 4 blocos e rejeita outros', () => {
    for (const b of ['PESQUISAR', 'ESCOLHER', 'CRIAR', 'VALIDAR'] as const) {
      assert.equal(BlocoTipoSchema.safeParse(b).success, true);
    }
    assert.equal(BlocoTipoSchema.safeParse('APROVAR').success, false);
  });

  it('OperadorSchema aceita os 3 operadores e rejeita outros', () => {
    for (const o of ['humano', 'ia', 'codigo'] as const) {
      assert.equal(OperadorSchema.safeParse(o).success, true);
    }
    assert.equal(OperadorSchema.safeParse('robot').success, false);
  });
});

// ── Bloco ──────────────────────────────────────────────────────────

describe('BlocoDefSchema', () => {
  it('bloco humano mínimo válido, com defaults entradas/saidas=[]', () => {
    const r = BlocoDefSchema.safeParse({
      id: 'b1',
      tipo: 'CRIAR',
      operador: 'humano',
      titulo: 'Escrever guião',
    });
    assert.equal(r.success, true);
    if (r.success) {
      assert.deepEqual(r.data.entradas, []);
      assert.deepEqual(r.data.saidas, []);
    }
  });

  it('VALIDAR + humano válido', () => {
    const r = BlocoDefSchema.safeParse({
      id: 'v1',
      tipo: 'VALIDAR',
      operador: 'humano',
      titulo: 'Aprovar título',
      saidas: [
        {
          chave: 'veredito',
          tipo: { tipo: 'controlo', controlo: 'aprovacao', cardinalidade: 'um' },
        },
      ],
    });
    assert.equal(r.success, true);
  });

  it('VALIDAR + ia rejeitado', () => {
    const r = BlocoDefSchema.safeParse({
      id: 'v1',
      tipo: 'VALIDAR',
      operador: 'ia',
      titulo: 'Aprovar título',
      extensaoId: 'exemplo.validador',
    });
    assert.equal(r.success, false);
  });

  it('VALIDAR + codigo rejeitado', () => {
    const r = BlocoDefSchema.safeParse({
      id: 'v1',
      tipo: 'VALIDAR',
      operador: 'codigo',
      titulo: 'Aprovar título',
      extensaoId: 'exemplo.validador',
    });
    assert.equal(r.success, false);
  });

  it("bloco 'ia' sem extensaoId rejeitado", () => {
    const r = BlocoDefSchema.safeParse({
      id: 'b1',
      tipo: 'CRIAR',
      operador: 'ia',
      titulo: 'Gerar títulos',
    });
    assert.equal(r.success, false);
  });

  it("bloco 'codigo' sem extensaoId rejeitado", () => {
    const r = BlocoDefSchema.safeParse({
      id: 'b1',
      tipo: 'PESQUISAR',
      operador: 'codigo',
      titulo: 'Pesquisar B-roll',
    });
    assert.equal(r.success, false);
  });

  it("bloco 'ia' com extensaoId válido", () => {
    const r = BlocoDefSchema.safeParse({
      id: 'b1',
      tipo: 'CRIAR',
      operador: 'ia',
      titulo: 'Gerar títulos',
      extensaoId: 'exemplo.titulos-ia',
    });
    assert.equal(r.success, true);
  });

  it("bloco 'humano' sem extensaoId válido (núcleo funciona sem extensões)", () => {
    const r = BlocoDefSchema.safeParse({
      id: 'b1',
      tipo: 'ESCOLHER',
      operador: 'humano',
      titulo: 'Escolher thumbnail',
    });
    assert.equal(r.success, true);
  });

  it('porta de entrada inválida → bloco rejeitado', () => {
    const r = BlocoDefSchema.safeParse({
      id: 'b1',
      tipo: 'CRIAR',
      operador: 'humano',
      titulo: 'X',
      entradas: [{ chave: '', tipo: { tipo: 'controlo', controlo: 'numero', cardinalidade: 'um' } }],
    });
    assert.equal(r.success, false);
  });
});

// ── Método ─────────────────────────────────────────────────────────

describe('MetodoDefSchema', () => {
  it('método válido', () => {
    const r = MetodoDefSchema.safeParse({
      processo: 'titulo',
      versao: 1,
      blocos: [{ id: 'b1', tipo: 'CRIAR', operador: 'humano', titulo: 'Gerar títulos' }],
    });
    assert.equal(r.success, true);
  });

  it('método sem blocos rejeitado', () => {
    const r = MetodoDefSchema.safeParse({ processo: 'titulo', blocos: [] });
    assert.equal(r.success, false);
  });

  it('ids de bloco duplicados rejeitados', () => {
    const r = MetodoDefSchema.safeParse({
      processo: 'titulo',
      blocos: [
        { id: 'b1', tipo: 'CRIAR', operador: 'humano', titulo: 'Um' },
        { id: 'b1', tipo: 'VALIDAR', operador: 'humano', titulo: 'Dois' },
      ],
    });
    assert.equal(r.success, false);
  });

  it('versao tem de ser inteiro positivo', () => {
    const base = {
      processo: 'titulo',
      blocos: [{ id: 'b1', tipo: 'CRIAR', operador: 'humano', titulo: 'Um' }],
    };
    assert.equal(MetodoDefSchema.safeParse({ ...base, versao: 0 }).success, false);
    assert.equal(MetodoDefSchema.safeParse({ ...base, versao: 1.5 }).success, false);
    assert.equal(MetodoDefSchema.safeParse({ ...base }).success, true);
  });
});

// ── Canal ──────────────────────────────────────────────────────────

function metodo(processo: ProcessoId): unknown {
  return {
    processo,
    blocos: [{ id: `b-${processo}`, tipo: 'CRIAR', operador: 'humano', titulo: `Bloco ${processo}` }],
  };
}

function canalValido(): unknown {
  return {
    nome: 'Canal de teste',
    ordemProcessos: [...PROCESSOS],
    metodos: PROCESSOS.map((p) => metodo(p)),
  };
}

describe('CanalDefSchema / validarCanal', () => {
  it('canal completo válido → validarCanal devolve []', () => {
    assert.deepEqual(validarCanal(canalValido()), []);
  });

  it('ordem com 7 processos rejeitada', () => {
    const canal = canalValido() as Record<string, unknown>;
    canal.ordemProcessos = (canal.ordemProcessos as string[]).slice(0, 7);
    const erros = validarCanal(canal);
    assert.equal(erros.length > 0, true);
  });

  it('ordem com 9 processos rejeitada', () => {
    const canal = canalValido() as Record<string, unknown>;
    canal.ordemProcessos = [...(canal.ordemProcessos as string[]), 'tema'];
    const erros = validarCanal(canal);
    assert.equal(erros.length > 0, true);
  });

  it('processo repetido na ordem rejeitado', () => {
    const canal = canalValido() as Record<string, unknown>;
    const ordem = [...(canal.ordemProcessos as string[])];
    ordem[7] = ordem[0]; // repete 'tema', 8 elementos
    canal.ordemProcessos = ordem;
    const erros = validarCanal(canal);
    assert.equal(erros.length > 0, true);
    assert.match(erros.join('\n'), /ordemProcessos/);
  });

  it('processo desconhecido na ordem rejeitado', () => {
    const canal = canalValido() as Record<string, unknown>;
    const ordem = [...(canal.ordemProcessos as string[])];
    ordem[0] = 'musica';
    canal.ordemProcessos = ordem;
    assert.equal(validarCanal(canal).length > 0, true);
  });

  it('método com processo repetido rejeitado', () => {
    const canal = canalValido() as Record<string, unknown>;
    const metodos = [...(canal.metodos as unknown[])];
    metodos[7] = metodo('tema'); // dois métodos para 'tema', nenhum para 'publicacao'
    canal.metodos = metodos;
    const erros = validarCanal(canal);
    assert.equal(erros.length > 0, true);
    assert.match(erros.join('\n'), /metodos/);
  });

  it('processo em falta nos métodos rejeitado', () => {
    const canal = canalValido() as Record<string, unknown>;
    canal.metodos = (canal.metodos as unknown[]).slice(0, 7);
    // repõe o length 8 com um método duplicado para isolar a regra de cobertura
    canal.metodos = [...(canal.metodos as unknown[]), metodo('tema')];
    const erros = validarCanal(canal);
    assert.equal(erros.length > 0, true);
    assert.match(erros.join('\n'), /publicacao/);
  });

  it('nome vazio rejeitado', () => {
    const canal = canalValido() as Record<string, unknown>;
    canal.nome = '';
    assert.equal(validarCanal(canal).length > 0, true);
  });

  it('método com bloco inválido (VALIDAR+ia) → validarCanal deteta', () => {
    const canal = canalValido() as Record<string, unknown>;
    const metodos = canal.metodos as Array<Record<string, unknown>>;
    metodos[0] = {
      processo: 'tema',
      blocos: [{ id: 'v1', tipo: 'VALIDAR', operador: 'ia', titulo: 'X', extensaoId: 'x.y' }],
    };
    const erros = validarCanal(canal);
    assert.equal(erros.length > 0, true);
    assert.match(erros.join('\n'), /VALIDAR/);
  });

  it('erros são legíveis (strings com caminho)', () => {
    const erros = validarCanal({ nome: '', ordemProcessos: [], metodos: [] });
    assert.equal(Array.isArray(erros), true);
    assert.equal(erros.length > 0, true);
    for (const e of erros) {
      assert.equal(typeof e, 'string');
      assert.match(e, /: /);
    }
  });

  it('validarCanal aceita unknown (null, strings)', () => {
    assert.equal(validarCanal(null).length > 0, true);
    assert.equal(validarCanal('canal').length > 0, true);
  });
});

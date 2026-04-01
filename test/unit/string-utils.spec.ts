import {
  normalizeForIntent,
  normalizeKeyword,
  levenshteinDistance,
  stringSimilarity,
  fuzzyMatchKeyword,
} from '@shared/utils/string-utils';

describe('string-utils', () => {
  describe('normalizeForIntent', () => {
    it('remove acentos', () => {
      expect(normalizeForIntent('transações')).toBe('transacoes');
      expect(normalizeForIntent('balanço')).toBe('balanco');
      expect(normalizeForIntent('situação do mês')).toBe('situacao do mes');
    });

    it('remove til solto (typo)', () => {
      expect(normalizeForIntent('transaç~eos')).toBe('transaceos');
    });

    it('converte para minúsculas', () => {
      expect(normalizeForIntent('MEU SALDO')).toBe('meu saldo');
    });

    it('colapsa espaços múltiplos', () => {
      expect(normalizeForIntent('meu    saldo')).toBe('meu saldo');
    });

    it('mantém $ e números para valores monetários', () => {
      expect(normalizeForIntent('R$ 50,00')).toContain('50,00');
    });
  });

  describe('normalizeKeyword', () => {
    it('mantém apenas letras e espaços', () => {
      expect(normalizeKeyword('transações!')).toBe('transacoes');
      expect(normalizeKeyword('meu saldo?')).toBe('meu saldo');
    });
  });

  describe('levenshteinDistance', () => {
    it('retorna 0 para strings iguais', () => {
      expect(levenshteinDistance('abc', 'abc')).toBe(0);
    });

    it('retorna distância correta para substituição', () => {
      expect(levenshteinDistance('cat', 'bat')).toBe(1);
    });

    it('retorna distância correta para inserção', () => {
      expect(levenshteinDistance('gato', 'gastos')).toBe(2);
    });
  });

  describe('stringSimilarity', () => {
    it('retorna 1 para strings idênticas', () => {
      expect(stringSimilarity('abc', 'abc')).toBe(1);
    });

    it('retorna 0 para strings completamente diferentes', () => {
      expect(stringSimilarity('abc', 'xyz')).toBe(0);
    });

    it('retorna alta similaridade para strings próximas', () => {
      expect(stringSimilarity('transacoes', 'transaceos')).toBeGreaterThan(0.7);
    });
  });

  describe('fuzzyMatchKeyword', () => {
    const keywords = ['transacoes', 'saldo', 'resumo', 'categoria'];

    it('retorna keyword exata quando existe', () => {
      expect(fuzzyMatchKeyword('transacoes', keywords)).toBe('transacoes');
    });

    it('retorna keyword próxima com typo', () => {
      expect(fuzzyMatchKeyword('transaceos', keywords)).toBe('transacoes');
    });

    it('retorna null para texto longo (>3 palavras)', () => {
      expect(fuzzyMatchKeyword('alguma coisa muito longa', keywords)).toBeNull();
    });

    it('retorna null quando nenhuma keyword é similar o suficiente', () => {
      expect(fuzzyMatchKeyword('xyz', keywords)).toBeNull();
    });
  });
});

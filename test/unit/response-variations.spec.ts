import {
  getHumanGreeting,
  getHowAreYouReply,
  getUnknownMessage,
  getHelpMessage,
  getListingIntro,
  getBalanceComment,
  getEmptyListMessage,
  getPostActionSuggestion,
  getSummaryIntro,
  getBalanceSummaryIntro,
  getSummaryBalanceComment,
  getCategoryInsight,
  getPredictedBalanceComment,
} from '@shared/utils/response-variations';

describe('response-variations', () => {
  describe('getHumanGreeting', () => {
    it('deve retornar uma string não vazia', () => {
      const result = getHumanGreeting();
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('deve incluir nome quando fornecido', () => {
      const result = getHumanGreeting('João Silva');
      expect(result).toContain('João');
    });
  });

  describe('getHowAreYouReply', () => {
    it('deve retornar uma string não vazia', () => {
      expect(getHowAreYouReply()).toBeTruthy();
    });
  });

  describe('getUnknownMessage', () => {
    it('deve conter sugestões de uso', () => {
      const msg = getUnknownMessage();
      expect(msg).toContain('ajuda');
    });
  });

  describe('getHelpMessage', () => {
    it('deve listar funcionalidades', () => {
      const msg = getHelpMessage();
      expect(msg).toContain('Registrar');
      expect(msg).toContain('Resumo');
      expect(msg).toContain('Transações');
    });
  });

  describe('getListingIntro', () => {
    it('deve retornar string vazia para count 0', () => {
      expect(getListingIntro(0)).toBe('');
    });

    it('deve retornar mensagem para count > 0', () => {
      expect(getListingIntro(5)).toBeTruthy();
    });
  });

  describe('getBalanceComment', () => {
    it('deve retornar positivo para saldo no azul', () => {
      const msg = getBalanceComment(3000, 10000, 7000);
      expect(msg.length).toBeGreaterThan(0);
    });

    it('deve retornar alerta para saldo negativo', () => {
      const msg = getBalanceComment(10000, 5000, -5000);
      expect(msg).toContain('categoria');
    });

    it('deve retornar equilíbrio para saldo zero', () => {
      const msg = getBalanceComment(5000, 5000, 0);
      expect(msg).toContain('equilíbrio');
    });
  });

  describe('getEmptyListMessage', () => {
    it('deve sugerir como registrar', () => {
      const msg = getEmptyListMessage();
      expect(msg).toContain('Gastei');
    });
  });

  describe('getPostActionSuggestion', () => {
    it('deve retornar dica após LIST_TRANSACTIONS', () => {
      // Chamar várias vezes — alguma deve retornar conteúdo (variações incluem string vazia)
      const results = Array.from({ length: 20 }, () => getPostActionSuggestion('LIST_TRANSACTIONS'));
      const nonEmpty = results.filter((r) => r.length > 0);
      expect(nonEmpty.length).toBeGreaterThan(0);
    });

    it('deve retornar string vazia para intent desconhecido', () => {
      expect(getPostActionSuggestion('UNKNOWN')).toBe('');
    });
  });

  describe('getSummaryIntro', () => {
    it('deve incluir o nome do mês', () => {
      const msg = getSummaryIntro('Março/2026');
      expect(msg).toContain('Março/2026');
    });
  });

  describe('getBalanceSummaryIntro', () => {
    it('deve retornar uma string não vazia', () => {
      expect(getBalanceSummaryIntro()).toBeTruthy();
    });
  });

  describe('getSummaryBalanceComment', () => {
    it('deve elogiar quando gastou menos da metade', () => {
      const msg = getSummaryBalanceComment(5000, 10000, 5000);
      // Balance positivo, ratio < 0.5
      expect(msg.length).toBeGreaterThan(0);
    });

    it('deve alertar quando negativo', () => {
      const msg = getSummaryBalanceComment(-3000, 5000, 8000);
      expect(msg).toContain('categoria');
    });

    it('deve comentar sem movimentação', () => {
      const msg = getSummaryBalanceComment(0, 0, 0);
      expect(msg).toContain('tranquilo');
    });

    it('deve tratar saldo zero', () => {
      const msg = getSummaryBalanceComment(0, 5000, 5000);
      expect(msg).toContain('Zerado');
    });
  });

  describe('getCategoryInsight', () => {
    it('deve alertar quando >50%', () => {
      const msg = getCategoryInsight('Alimentação', 55);
      expect(msg).toContain('metade');
    });

    it('deve mencionar pressão quando 30-50%', () => {
      const msg = getCategoryInsight('Transporte', 35);
      expect(msg).toContain('puxou');
    });

    it('deve elogiar distribuição quando <30%', () => {
      const msg = getCategoryInsight('Lazer', 15);
      expect(msg).toContain('distribuídos');
    });
  });

  describe('getPredictedBalanceComment', () => {
    it('deve ser positivo quando previsão > 0', () => {
      const msg = getPredictedBalanceComment(1000);
      expect(msg).toContain('📈');
    });

    it('deve alertar quando previsão <= 0', () => {
      const msg = getPredictedBalanceComment(-500);
      expect(msg).toContain('📉');
    });
  });
});

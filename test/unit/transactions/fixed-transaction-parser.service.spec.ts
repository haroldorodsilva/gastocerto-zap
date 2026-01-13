import { Test, TestingModule } from '@nestjs/testing';
import { FixedTransactionParserService } from '@features/transactions/services/parsers/fixed-transaction-parser.service';

describe('FixedTransactionParserService', () => {
  let service: FixedTransactionParserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FixedTransactionParserService],
    }).compile();

    service = module.get<FixedTransactionParserService>(FixedTransactionParserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('detectFixed - MONTHLY', () => {
    it('should detect "todo mês"', () => {
      const result = service.detectFixed('pago todo mês 50 de internet');
      expect(result.isFixed).toBe(true);
      expect(result.frequency).toBe('MONTHLY');
      expect(result.confidence).toBeGreaterThan(0.8);
      expect(result.matchedKeywords).toContain('todo mês');
    });

    it('should detect "mensal"', () => {
      const result = service.detectFixed('assinatura mensal de 30 reais');
      expect(result.isFixed).toBe(true);
      expect(result.frequency).toBe('MONTHLY');
      expect(result.matchedKeywords).toContain('mensal');
    });

    it('should detect "mensalidade"', () => {
      const result = service.detectFixed('paguei a mensalidade da academia');
      expect(result.isFixed).toBe(true);
      expect(result.frequency).toBe('MONTHLY');
      expect(result.matchedKeywords.some(k => k.includes('mensal'))).toBe(true);
    });

    it('should detect "assinatura"', () => {
      const result = service.detectFixed('assinatura netflix');
      expect(result.isFixed).toBe(true);
      expect(result.frequency).toBe('MONTHLY');
      expect(result.matchedKeywords).toContain('assinatura');
    });

    it('should detect "recorrente"', () => {
      const result = service.detectFixed('pagamento recorrente');
      expect(result.isFixed).toBe(true);
      expect(result.frequency).toBe('MONTHLY');
      expect(result.matchedKeywords).toContain('recorrente');
    });

    it('should detect "fixo"', () => {
      const result = service.detectFixed('gasto fixo mensal');
      expect(result.isFixed).toBe(true);
      expect(result.frequency).toBe('MONTHLY');
    });
  });

  describe('detectFixed - WEEKLY', () => {
    it('should detect "toda semana"', () => {
      const result = service.detectFixed('compro toda semana no mercado');
      expect(result.isFixed).toBe(true);
      expect(result.frequency).toBe('WEEKLY');
      expect(result.matchedKeywords).toContain('toda semana');
    });

    it('should detect "semanal"', () => {
      const result = service.detectFixed('gasto semanal com feira');
      expect(result.isFixed).toBe(true);
      expect(result.frequency).toBe('WEEKLY');
      expect(result.matchedKeywords).toContain('semanal');
    });
  });

  describe('detectFixed - ANNUAL', () => {
    it('should detect "todo ano"', () => {
      const result = service.detectFixed('pago todo ano o IPVA');
      expect(result.isFixed).toBe(true);
      expect(result.frequency).toBe('ANNUAL');
      expect(result.matchedKeywords).toContain('todo ano');
    });

    it('should detect "anual"', () => {
      const result = service.detectFixed('renovação anual do seguro');
      expect(result.isFixed).toBe(true);
      expect(result.frequency).toBe('ANNUAL');
      expect(result.matchedKeywords).toContain('anual');
    });

    it('should detect "anuidade"', () => {
      const result = service.detectFixed('paguei a anuidade do cartão');
      expect(result.isFixed).toBe(true);
      expect(result.frequency).toBe('ANNUAL');
      expect(result.matchedKeywords).toContain('anuidade');
    });
  });

  describe('detectFixed - BIENNIAL', () => {
    it('should detect "bienal"', () => {
      const result = service.detectFixed('pagamento bienal da CNH');
      expect(result.isFixed).toBe(true);
      expect(result.frequency).toBe('BIENNIAL');
      expect(result.matchedKeywords).toContain('bienal');
    });

    it('should detect "a cada 2 anos"', () => {
      const result = service.detectFixed('pago a cada 2 anos');
      expect(result.isFixed).toBe(true);
      expect(result.frequency).toBe('BIENNIAL');
      expect(result.matchedKeywords).toContain('a cada 2 anos');
    });
  });

  describe('detectFixed - Negative cases', () => {
    it('should NOT detect fixed in normal transaction', () => {
      const result = service.detectFixed('comprei uma TV de 1000 reais');
      expect(result.isFixed).toBe(false);
      expect(result.frequency).toBeUndefined();
      expect(result.confidence).toBe(0);
    });

    it('should NOT detect fixed in one-time purchase', () => {
      const result = service.detectFixed('gastei 50 no restaurante');
      expect(result.isFixed).toBe(false);
    });

    it('should handle empty text', () => {
      const result = service.detectFixed('');
      expect(result.isFixed).toBe(false);
      expect(result.confidence).toBe(0);
    });
  });

  describe('detectFixed - Complex scenarios', () => {
    it('should detect fixed with amount and category', () => {
      const result = service.detectFixed('pago todo mês 100 reais de academia');
      expect(result.isFixed).toBe(true);
      expect(result.frequency).toBe('MONTHLY');
    });

    it('should detect fixed with date reference', () => {
      const result = service.detectFixed('paguei hoje a mensalidade que vence todo dia 5');
      expect(result.isFixed).toBe(true);
      expect(result.frequency).toBe('MONTHLY');
    });
  });
});

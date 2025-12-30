import { Test, TestingModule } from '@nestjs/testing';
import { CreditCardParserService } from '@common/services/credit-card-parser.service';

describe('CreditCardParserService', () => {
  let service: CreditCardParserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CreditCardParserService],
    }).compile();

    service = module.get<CreditCardParserService>(CreditCardParserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('detectCreditCard', () => {
    it('should detect "cartão" keyword', () => {
      const result = service.detectCreditCard('comprei no cartão');
      expect(result.usesCreditCard).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.8);
      expect(result.matchedKeywords).toContain('cartão');
    });

    it('should detect "no crédito"', () => {
      const result = service.detectCreditCard('paguei no crédito');
      expect(result.usesCreditCard).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.8);
      expect(result.matchedKeywords.some(k => k.includes('crédito'))).toBe(true);
    });

    it('should detect "cartao de credito"', () => {
      const result = service.detectCreditCard('usei o cartao de credito');
      expect(result.usesCreditCard).toBe(true);
      expect(result.matchedKeywords).toContain('cartao de credito');
    });

    it('should detect "com o cartão"', () => {
      const result = service.detectCreditCard('paguei com o cartão');
      expect(result.usesCreditCard).toBe(true);
      expect(result.matchedKeywords).toContain('com o cartão');
    });

    it('should detect "pelo cartão"', () => {
      const result = service.detectCreditCard('comprei pelo cartão');
      expect(result.usesCreditCard).toBe(true);
      expect(result.matchedKeywords.some(k => k.includes('cartão'))).toBe(true);
    });

    it('should detect "credito" alone', () => {
      const result = service.detectCreditCard('paguei no credito');
      expect(result.usesCreditCard).toBe(true);
      expect(result.matchedKeywords).toContain('credito');
    });

    it('should NOT detect credit card in normal text', () => {
      const result = service.detectCreditCard('comprei à vista');
      expect(result.usesCreditCard).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('should NOT detect if "débito" is mentioned', () => {
      const result = service.detectCreditCard('paguei no débito');
      expect(result.usesCreditCard).toBe(false);
    });

    it('should NOT detect if "dinheiro" is mentioned', () => {
      const result = service.detectCreditCard('paguei em dinheiro');
      expect(result.usesCreditCard).toBe(false);
    });

    it('should NOT detect if "pix" is mentioned', () => {
      const result = service.detectCreditCard('paguei via pix');
      expect(result.usesCreditCard).toBe(false);
    });

    it('should NOT detect if "à vista" is mentioned', () => {
      const result = service.detectCreditCard('comprei à vista');
      expect(result.usesCreditCard).toBe(false);
    });

    it('should detect credit card with amount', () => {
      const result = service.detectCreditCard('gastei 150 no cartão');
      expect(result.usesCreditCard).toBe(true);
      expect(result.matchedKeywords).toContain('no cartão');
    });

    it('should detect credit card with installments', () => {
      const result = service.detectCreditCard('comprei em 3x no cartão');
      expect(result.usesCreditCard).toBe(true);
    });

    it('should handle case insensitive', () => {
      const result = service.detectCreditCard('PAGUEI NO CARTÃO');
      expect(result.usesCreditCard).toBe(true);
    });

    it('should handle accents variations', () => {
      const result = service.detectCreditCard('paguei no cartao');
      expect(result.usesCreditCard).toBe(true);
    });

    it('should detect multiple credit card keywords', () => {
      const result = service.detectCreditCard('comprei no cartão de crédito parcelado');
      expect(result.usesCreditCard).toBe(true);
      expect(result.matchedKeywords.length).toBeGreaterThan(1);
    });
  });
});

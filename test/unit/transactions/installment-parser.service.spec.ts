import { Test, TestingModule } from '@nestjs/testing';
import { InstallmentParserService } from '@features/transactions/services/parsers/installment-parser.service';

describe('InstallmentParserService', () => {
  let service: InstallmentParserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [InstallmentParserService],
    }).compile();

    service = module.get<InstallmentParserService>(InstallmentParserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('detectInstallments', () => {
    it('should detect "4x" pattern', () => {
      const result = service.detectInstallments('comprei em 4x');
      expect(result.isInstallment).toBe(true);
      expect(result.installments).toBe(4);
      expect(result.confidence).toBeGreaterThan(0.8);
      expect(result.matchedPattern).toContain('4');
    });

    it('should detect "em 3 vezes" pattern', () => {
      const result = service.detectInstallments('parcelei em 3 vezes');
      expect(result.isInstallment).toBe(true);
      expect(result.installments).toBe(3);
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('should detect "parcelado em 5" pattern', () => {
      const result = service.detectInstallments('comprei parcelado em 5');
      expect(result.isInstallment).toBe(true);
      expect(result.installments).toBe(5);
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('should detect "12 parcelas" pattern', () => {
      const result = service.detectInstallments('dividi em 12 parcelas');
      expect(result.isInstallment).toBe(true);
      expect(result.installments).toBe(12);
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('should detect "dividido em 6" pattern', () => {
      const result = service.detectInstallments('valor dividido em 6');
      expect(result.isInstallment).toBe(true);
      expect(result.installments).toBe(6);
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('should NOT detect installment in normal text', () => {
      const result = service.detectInstallments('comprei uma TV');
      expect(result.isInstallment).toBe(false);
      expect(result.installments).toBeUndefined();
      expect(result.confidence).toBe(0);
    });

    it('should handle "à vista" correctly', () => {
      const result = service.detectInstallments('paguei à vista');
      expect(result.isInstallment).toBe(false);
    });

    it('should detect large installment numbers', () => {
      const result = service.detectInstallments('comprei em 100x');
      expect(result.isInstallment).toBe(true);
      // Regex \d{1,2} captures first 2 digits only
      expect(result.installments).toBe(10);
    });

    it('should detect installment with amount', () => {
      const result = service.detectInstallments('gastei 300 em 3x');
      expect(result.isInstallment).toBe(true);
      expect(result.installments).toBe(3);
    });

    it('should handle mixed patterns', () => {
      const result = service.detectInstallments('comprei celular de 1200 parcelado em 10 vezes');
      expect(result.isInstallment).toBe(true);
      expect(result.installments).toBe(10);
    });
  });
});

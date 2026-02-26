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

  describe('installmentValueType - INSTALLMENT_VALUE vs GROSS_VALUE', () => {
    describe('INSTALLMENT_VALUE - valor informado é da parcela', () => {
      it('"10x de 50" → INSTALLMENT_VALUE (50 é valor da parcela)', () => {
        const result = service.detectInstallments('10x de 50');
        expect(result.isInstallment).toBe(true);
        expect(result.installments).toBe(10);
        expect(result.installmentValueType).toBe('INSTALLMENT_VALUE');
      });

      it('"pagar 5x de 100 reais" → INSTALLMENT_VALUE', () => {
        const result = service.detectInstallments('pagar 5x de 100 reais');
        expect(result.isInstallment).toBe(true);
        expect(result.installments).toBe(5);
        expect(result.installmentValueType).toBe('INSTALLMENT_VALUE');
      });

      it('"3 parcelas de 200" → INSTALLMENT_VALUE', () => {
        const result = service.detectInstallments('3 parcelas de 200');
        expect(result.isInstallment).toBe(true);
        expect(result.installments).toBe(3);
        expect(result.installmentValueType).toBe('INSTALLMENT_VALUE');
      });

      it('"dividido em 4x de 150" → INSTALLMENT_VALUE', () => {
        const result = service.detectInstallments('dividido em 4x de 150');
        expect(result.isInstallment).toBe(true);
        expect(result.installments).toBe(4);
        expect(result.installmentValueType).toBe('INSTALLMENT_VALUE');
      });

      it('"6 vezes de 50 reais" → INSTALLMENT_VALUE', () => {
        const result = service.detectInstallments('6 vezes de 50 reais');
        expect(result.isInstallment).toBe(true);
        expect(result.installments).toBe(6);
        expect(result.installmentValueType).toBe('INSTALLMENT_VALUE');
      });

      it('"12 parcelas de R$ 89,90" → INSTALLMENT_VALUE', () => {
        const result = service.detectInstallments('12 parcelas de R$ 89,90');
        expect(result.isInstallment).toBe(true);
        expect(result.installments).toBe(12);
        expect(result.installmentValueType).toBe('INSTALLMENT_VALUE');
      });
    });

    describe('GROSS_VALUE - valor informado é o total', () => {
      it('"comprei uma bike de 1000 em 10x" → GROSS_VALUE (1000 é total)', () => {
        const result = service.detectInstallments('comprei uma bike de 1000 em 10x');
        expect(result.isInstallment).toBe(true);
        expect(result.installments).toBe(10);
        expect(result.installmentValueType).toBe('GROSS_VALUE');
      });

      it('"gastei 500 em 5x" → GROSS_VALUE', () => {
        const result = service.detectInstallments('gastei 500 em 5x');
        expect(result.isInstallment).toBe(true);
        expect(result.installments).toBe(5);
        expect(result.installmentValueType).toBe('GROSS_VALUE');
      });

      it('"TV de 3000 em 12 parcelas" → GROSS_VALUE', () => {
        const result = service.detectInstallments('TV de 3000 em 12 parcelas');
        expect(result.isInstallment).toBe(true);
        expect(result.installments).toBe(12);
        expect(result.installmentValueType).toBe('GROSS_VALUE');
      });

      it('"comprei celular de 1200 parcelado em 10 vezes" → GROSS_VALUE', () => {
        const result = service.detectInstallments('comprei celular de 1200 parcelado em 10 vezes');
        expect(result.isInstallment).toBe(true);
        expect(result.installments).toBe(10);
        expect(result.installmentValueType).toBe('GROSS_VALUE');
      });

      it('"gastei 300 em 3x" → GROSS_VALUE', () => {
        const result = service.detectInstallments('gastei 300 em 3x');
        expect(result.isInstallment).toBe(true);
        expect(result.installments).toBe(3);
        expect(result.installmentValueType).toBe('GROSS_VALUE');
      });

      it('"comprei em 4x" (sem valor) → GROSS_VALUE por padrão', () => {
        const result = service.detectInstallments('comprei em 4x');
        expect(result.isInstallment).toBe(true);
        expect(result.installments).toBe(4);
        expect(result.installmentValueType).toBe('GROSS_VALUE');
      });

      it('"parcelei em 6 vezes" (sem valor) → GROSS_VALUE por padrão', () => {
        const result = service.detectInstallments('parcelei em 6 vezes');
        expect(result.isInstallment).toBe(true);
        expect(result.installments).toBe(6);
        expect(result.installmentValueType).toBe('GROSS_VALUE');
      });

      it('"valor dividido em 6" → GROSS_VALUE', () => {
        const result = service.detectInstallments('valor dividido em 6');
        expect(result.isInstallment).toBe(true);
        expect(result.installments).toBe(6);
        expect(result.installmentValueType).toBe('GROSS_VALUE');
      });
    });

    describe('Cenários reais completos', () => {
      it('"comprei geladeira de 2500 em 10x no cartão" → 10x GROSS_VALUE', () => {
        const result = service.detectInstallments('comprei geladeira de 2500 em 10x no cartão');
        expect(result.isInstallment).toBe(true);
        expect(result.installments).toBe(10);
        expect(result.installmentValueType).toBe('GROSS_VALUE');
      });

      it('"vou pagar 12x de 99,90 no celular novo" → 12x INSTALLMENT_VALUE', () => {
        const result = service.detectInstallments('vou pagar 12x de 99,90 no celular novo');
        expect(result.isInstallment).toBe(true);
        expect(result.installments).toBe(12);
        expect(result.installmentValueType).toBe('INSTALLMENT_VALUE');
      });

      it('"sofá de 4000 parcelado em 8" → 8x GROSS_VALUE', () => {
        const result = service.detectInstallments('sofá de 4000 parcelado em 8');
        expect(result.isInstallment).toBe(true);
        expect(result.installments).toBe(8);
        expect(result.installmentValueType).toBe('GROSS_VALUE');
      });

      it('"3 parcelas de 333,33 no dentista" → 3x INSTALLMENT_VALUE', () => {
        const result = service.detectInstallments('3 parcelas de 333,33 no dentista');
        expect(result.isInstallment).toBe(true);
        expect(result.installments).toBe(3);
        expect(result.installmentValueType).toBe('INSTALLMENT_VALUE');
      });
    });
  });
});

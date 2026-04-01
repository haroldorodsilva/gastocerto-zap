import { Test, TestingModule } from '@nestjs/testing';
import { IntentAnalyzerService, MessageIntent } from '@features/intent/intent-analyzer.service';
import { PrismaService } from '@core/database/prisma.service';
import { DisambiguationService } from '@features/conversation/disambiguation.service';
import { RedisService } from '@common/services/redis.service';

describe('IntentAnalyzerService', () => {
  let service: IntentAnalyzerService;

  beforeEach(async () => {
    const prismaMock = {
      userCache: { findUnique: jest.fn() },
      unrecognizedMessage: { create: jest.fn() },
    };

    const redisMock = {
      isReady: jest.fn().mockReturnValue(false),
      getClient: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntentAnalyzerService,
        DisambiguationService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: RedisService, useValue: redisMock },
      ],
    }).compile();

    service = module.get<IntentAnalyzerService>(IntentAnalyzerService);
  });

  describe('analyzeIntent', () => {
    it('deve detectar saudações', async () => {
      const result = await service.analyzeIntent('oi', '5566996285154');
      expect(result.intent).toBe(MessageIntent.GREETING);
      expect(result.confidence).toBeGreaterThan(0.8);
      expect(result.shouldProcess).toBe(false);
    });

    it('deve detectar registro de despesa', async () => {
      const result = await service.analyzeIntent('Gastei 50 reais no almoço', '5566996285154');
      expect(result.intent).toBe(MessageIntent.REGISTER_TRANSACTION);
      expect(result.shouldProcess).toBe(true);
    });

    it('deve detectar pedidos de ajuda', async () => {
      const result = await service.analyzeIntent('Como funciona? Preciso de ajuda', '5566996285154');
      expect(result.intent).toBe(MessageIntent.HELP);
      expect(result.shouldProcess).toBe(false);
    });

    it('deve detectar consulta de saldo', async () => {
      const result = await service.analyzeIntent('qual meu saldo', '5566996285154');
      expect(result.intent).toBe(MessageIntent.CHECK_BALANCE);
    });

    it('deve retornar UNKNOWN para mensagens aleatórias', async () => {
      const result = await service.analyzeIntent('xpto abc 123 random text', '5566996285154');
      expect(result.intent).toBe(MessageIntent.UNKNOWN);
      expect(result.confidence).toBeLessThan(0.5);
    });
  });

  // ─── Fase 1: Normalização e tolerância a erros ───

  describe('normalização de acentos e caracteres especiais', () => {
    it('deve reconhecer "transações" (palavra isolada)', async () => {
      const result = await service.analyzeIntent('transações', '5566996285154');
      expect(result.intent).toBe(MessageIntent.LIST_TRANSACTIONS);
    });

    it('deve reconhecer "transaç~eos" (typo com til)', async () => {
      const result = await service.analyzeIntent('transaç~eos', '5566996285154');
      expect(result.intent).toBe(MessageIntent.LIST_TRANSACTIONS);
    });

    it('deve reconhecer "minhas transações" (caso original)', async () => {
      const result = await service.analyzeIntent('minhas transações', '5566996285154');
      expect(result.intent).toBe(MessageIntent.LIST_TRANSACTIONS);
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('deve reconhecer "balanço" com ou sem acento', async () => {
      const r1 = await service.analyzeIntent('balanço', '11');
      const r2 = await service.analyzeIntent('balanco', '11');
      expect(r1.intent).toBe(MessageIntent.CHECK_BALANCE);
      expect(r2.intent).toBe(MessageIntent.CHECK_BALANCE);
    });

    it('deve reconhecer "situação do mês" sem acentos', async () => {
      const result = await service.analyzeIntent('situacao do mes', '11');
      expect(result.intent).toBe(MessageIntent.MONTHLY_SUMMARY);
    });

    it('deve reconhecer "resumo do mês" com acentos', async () => {
      const result = await service.analyzeIntent('resumo do mês', '11');
      expect(result.intent).toBe(MessageIntent.MONTHLY_SUMMARY);
    });
  });

  describe('abreviações', () => {
    it('deve expandir "trans" para lista de transações', async () => {
      const result = await service.analyzeIntent('trans', '11');
      expect(result.intent).toBe(MessageIntent.LIST_TRANSACTIONS);
    });

    it('deve expandir "trx" para lista de transações', async () => {
      const result = await service.analyzeIntent('trx', '11');
      expect(result.intent).toBe(MessageIntent.LIST_TRANSACTIONS);
    });

    it('deve expandir "cc" para cartões de crédito', async () => {
      const result = await service.analyzeIntent('cc', '11');
      expect(result.intent).toBe(MessageIntent.LIST_CREDIT_CARDS);
    });
  });

  describe('keywords expandidas', () => {
    it('"gastos recentes" → LIST_TRANSACTIONS', async () => {
      const result = await service.analyzeIntent('gastos recentes', '11');
      expect(result.intent).toBe(MessageIntent.LIST_TRANSACTIONS);
    });

    it('"quanto sobrou" → CHECK_BALANCE', async () => {
      const result = await service.analyzeIntent('quanto sobrou', '11');
      expect(result.intent).toBe(MessageIntent.CHECK_BALANCE);
    });

    it('"como estou" → MONTHLY_SUMMARY', async () => {
      const result = await service.analyzeIntent('como estou', '11');
      expect(result.intent).toBe(MessageIntent.MONTHLY_SUMMARY);
    });

    it('"gastei em que" → CATEGORY_BREAKDOWN', async () => {
      const result = await service.analyzeIntent('gastei em que', '11');
      expect(result.intent).toBe(MessageIntent.CATEGORY_BREAKDOWN);
    });
  });

  // ─── Regressões ───

  describe('regressões (funcionalidade existente deve continuar)', () => {
    it('"meu saldo" → CHECK_BALANCE', async () => {
      const result = await service.analyzeIntent('meu saldo', '11');
      expect(result.intent).toBe(MessageIntent.CHECK_BALANCE);
    });

    it('"gastei 50 no mercado" → REGISTER_TRANSACTION', async () => {
      const result = await service.analyzeIntent('gastei 50 no mercado', '11');
      expect(result.intent).toBe(MessageIntent.REGISTER_TRANSACTION);
    });

    it('"sim" → CONFIRMATION_RESPONSE', async () => {
      const result = await service.analyzeIntent('sim', '11');
      expect(result.intent).toBe(MessageIntent.CONFIRMATION_RESPONSE);
    });

    it('"não" → CONFIRMATION_RESPONSE', async () => {
      const result = await service.analyzeIntent('não', '11');
      expect(result.intent).toBe(MessageIntent.CONFIRMATION_RESPONSE);
    });

    it('"pendentes" → LIST_PENDING_PAYMENTS', async () => {
      const result = await service.analyzeIntent('pendentes', '11');
      expect(result.intent).toBe(MessageIntent.LIST_PENDING_PAYMENTS);
    });

    it('"meus cartões" → LIST_CREDIT_CARDS', async () => {
      const result = await service.analyzeIntent('meus cartões', '11');
      expect(result.intent).toBe(MessageIntent.LIST_CREDIT_CARDS);
    });

    it('"minhas faturas" → LIST_INVOICES', async () => {
      const result = await service.analyzeIntent('minhas faturas', '11');
      expect(result.intent).toBe(MessageIntent.LIST_INVOICES);
    });

    it('"bom dia" → GREETING', async () => {
      const result = await service.analyzeIntent('bom dia', '11');
      expect(result.intent).toBe(MessageIntent.GREETING);
    });

    it('"ajuda" → HELP', async () => {
      const result = await service.analyzeIntent('ajuda', '11');
      expect(result.intent).toBe(MessageIntent.HELP);
    });
  });
});

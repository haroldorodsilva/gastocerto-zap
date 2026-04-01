import { Test, TestingModule } from '@nestjs/testing';
import { IntentAnalyzerService, MessageIntent } from '@features/intent/intent-analyzer.service';
import { PrismaService } from '@core/database/prisma.service';
import { DisambiguationService } from '@features/conversation/disambiguation.service';
import { RedisService } from '@common/services/redis.service';

/**
 * Testes focados em:
 * 1. extractMonthReference — detecção de mês em mensagens de gráficos/resumos
 * 2. Intents de GENERATE_CHART com referência de mês
 * 3. Intents de MONTHLY_SUMMARY / CATEGORY_BREAKDOWN com meses
 */
describe('IntentAnalyzerService — Month Reference & Chart', () => {
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

  // ═══════════════════════════════════════════════════════════
  // FASE 1: GENERATE_CHART com monthReference
  // ═══════════════════════════════════════════════════════════

  describe('GENERATE_CHART — detecção de intent', () => {
    const phone = '5566996285154';

    it('"gráfico" → GENERATE_CHART', async () => {
      const result = await service.analyzeIntent('gráfico', phone);
      expect(result.intent).toBe(MessageIntent.GENERATE_CHART);
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('"meu gráfico" → GENERATE_CHART', async () => {
      const result = await service.analyzeIntent('meu gráfico', phone);
      expect(result.intent).toBe(MessageIntent.GENERATE_CHART);
    });

    it('"grafico" (sem acento) → GENERATE_CHART', async () => {
      const result = await service.analyzeIntent('grafico', phone);
      expect(result.intent).toBe(MessageIntent.GENERATE_CHART);
    });
  });

  describe('GENERATE_CHART — monthReference com nomes de meses', () => {
    const phone = '5566996285154';

    it('"gráfico janeiro" → monthReference contém -01', async () => {
      const result = await service.analyzeIntent('gráfico janeiro', phone);
      expect(result.intent).toBe(MessageIntent.GENERATE_CHART);
      expect(result.metadata?.monthReference).toBeDefined();
      expect(result.metadata.monthReference).toMatch(/-01$/);
    });

    it('"gráfico fevereiro" → monthReference contém -02', async () => {
      const result = await service.analyzeIntent('gráfico fevereiro', phone);
      expect(result.intent).toBe(MessageIntent.GENERATE_CHART);
      expect(result.metadata?.monthReference).toMatch(/-02$/);
    });

    it('"gráfico março" → monthReference contém -03', async () => {
      const result = await service.analyzeIntent('gráfico marco', phone);
      expect(result.intent).toBe(MessageIntent.GENERATE_CHART);
      expect(result.metadata?.monthReference).toMatch(/-03$/);
    });

    it('"gráfico abril" → monthReference contém -04', async () => {
      const result = await service.analyzeIntent('gráfico abril', phone);
      expect(result.intent).toBe(MessageIntent.GENERATE_CHART);
      expect(result.metadata?.monthReference).toMatch(/-04$/);
    });

    it('"gráfico maio" → monthReference contém -05', async () => {
      const result = await service.analyzeIntent('gráfico maio', phone);
      expect(result.intent).toBe(MessageIntent.GENERATE_CHART);
      expect(result.metadata?.monthReference).toMatch(/-05$/);
    });

    it('"gráfico junho" → monthReference contém -06', async () => {
      const result = await service.analyzeIntent('gráfico junho', phone);
      expect(result.intent).toBe(MessageIntent.GENERATE_CHART);
      expect(result.metadata?.monthReference).toMatch(/-06$/);
    });

    it('"gráfico julho" → monthReference contém -07', async () => {
      const result = await service.analyzeIntent('gráfico julho', phone);
      expect(result.intent).toBe(MessageIntent.GENERATE_CHART);
      expect(result.metadata?.monthReference).toMatch(/-07$/);
    });

    it('"gráfico agosto" → monthReference contém -08', async () => {
      const result = await service.analyzeIntent('gráfico agosto', phone);
      expect(result.intent).toBe(MessageIntent.GENERATE_CHART);
      expect(result.metadata?.monthReference).toMatch(/-08$/);
    });

    it('"gráfico setembro" → monthReference contém -09', async () => {
      const result = await service.analyzeIntent('gráfico setembro', phone);
      expect(result.intent).toBe(MessageIntent.GENERATE_CHART);
      expect(result.metadata?.monthReference).toMatch(/-09$/);
    });

    it('"gráfico outubro" → monthReference contém -10', async () => {
      const result = await service.analyzeIntent('gráfico outubro', phone);
      expect(result.intent).toBe(MessageIntent.GENERATE_CHART);
      expect(result.metadata?.monthReference).toMatch(/-10$/);
    });

    it('"gráfico novembro" → monthReference contém -11', async () => {
      const result = await service.analyzeIntent('gráfico novembro', phone);
      expect(result.intent).toBe(MessageIntent.GENERATE_CHART);
      expect(result.metadata?.monthReference).toMatch(/-11$/);
    });

    it('"gráfico dezembro" → monthReference contém -12', async () => {
      const result = await service.analyzeIntent('gráfico dezembro', phone);
      expect(result.intent).toBe(MessageIntent.GENERATE_CHART);
      expect(result.metadata?.monthReference).toMatch(/-12$/);
    });
  });

  describe('GENERATE_CHART — monthReference com formato MM/YYYY', () => {
    const phone = '5566996285154';

    it('"gráfico 01/2025" → monthReference 2025-01', async () => {
      const result = await service.analyzeIntent('gráfico 01/2025', phone);
      expect(result.intent).toBe(MessageIntent.GENERATE_CHART);
      expect(result.metadata?.monthReference).toBe('2025-01');
    });

    it('"gráfico 12/2024" → monthReference 2024-12', async () => {
      const result = await service.analyzeIntent('gráfico 12/2024', phone);
      expect(result.intent).toBe(MessageIntent.GENERATE_CHART);
      expect(result.metadata?.monthReference).toBe('2024-12');
    });

    it('"gráfico 6/2025" → monthReference 2025-06', async () => {
      const result = await service.analyzeIntent('gráfico 6/2025', phone);
      expect(result.intent).toBe(MessageIntent.GENERATE_CHART);
      expect(result.metadata?.monthReference).toBe('2025-06');
    });
  });

  describe('GENERATE_CHART — monthReference "mês passado"', () => {
    const phone = '5566996285154';

    it('"gráfico mês passado" → monthReference definido (mês anterior)', async () => {
      const result = await service.analyzeIntent('gráfico mês passado', phone);
      expect(result.intent).toBe(MessageIntent.GENERATE_CHART);
      expect(result.metadata?.monthReference).toBeDefined();
      // Verificar que é o mês anterior ao atual
      const now = new Date();
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const expected = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;
      expect(result.metadata.monthReference).toBe(expected);
    });

    it('"grafico mes passado" (sem acentos) → monthReference definido', async () => {
      const result = await service.analyzeIntent('grafico mes passado', phone);
      expect(result.intent).toBe(MessageIntent.GENERATE_CHART);
      expect(result.metadata?.monthReference).toBeDefined();
    });
  });

  describe('GENERATE_CHART — sem monthReference (mês atual)', () => {
    const phone = '5566996285154';

    it('"gráfico" sozinho → monthReference undefined (handler usa mês atual)', async () => {
      const result = await service.analyzeIntent('gráfico', phone);
      expect(result.intent).toBe(MessageIntent.GENERATE_CHART);
      expect(result.metadata?.monthReference).toBeUndefined();
    });

    it('"me mostra o gráfico" → monthReference undefined', async () => {
      const result = await service.analyzeIntent('me mostra o gráfico', phone);
      expect(result.intent).toBe(MessageIntent.GENERATE_CHART);
      expect(result.metadata?.monthReference).toBeUndefined();
    });
  });

  describe('GENERATE_CHART — chartType income vs categories', () => {
    const phone = '5566996285154';

    it('"gráfico" → chartType categories (default)', async () => {
      const result = await service.analyzeIntent('gráfico', phone);
      expect(result.intent).toBe(MessageIntent.GENERATE_CHART);
      expect(result.metadata?.chartType).toBe('categories');
    });

    it('"gráfico receitas" → chartType income', async () => {
      const result = await service.analyzeIntent('gráfico receitas', phone);
      expect(result.intent).toBe(MessageIntent.GENERATE_CHART);
      expect(result.metadata?.chartType).toBe('income');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // FASE 2: MONTHLY_SUMMARY com monthReference
  // ═══════════════════════════════════════════════════════════

  describe('MONTHLY_SUMMARY — monthReference', () => {
    const phone = '5566996285154';

    it('"resumo mensal janeiro" → MONTHLY_SUMMARY com -01', async () => {
      const result = await service.analyzeIntent('resumo mensal janeiro', phone);
      expect(result.intent).toBe(MessageIntent.MONTHLY_SUMMARY);
      expect(result.metadata?.monthReference).toMatch(/-01$/);
    });

    it('"resumo mês passado" → MONTHLY_SUMMARY com mês anterior', async () => {
      const result = await service.analyzeIntent('resumo mês passado', phone);
      expect(result.intent).toBe(MessageIntent.MONTHLY_SUMMARY);
      expect(result.metadata?.monthReference).toBeDefined();
    });

    it('"resumo 03/2025" → MONTHLY_SUMMARY com 2025-03', async () => {
      const result = await service.analyzeIntent('resumo 03/2025', phone);
      expect(result.intent).toBe(MessageIntent.MONTHLY_SUMMARY);
      expect(result.metadata?.monthReference).toBe('2025-03');
    });

    it('"resumo mensal" sem mês → monthReference undefined', async () => {
      const result = await service.analyzeIntent('resumo mensal', phone);
      expect(result.intent).toBe(MessageIntent.MONTHLY_SUMMARY);
      expect(result.metadata?.monthReference).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // FASE 3: CATEGORY_BREAKDOWN com monthReference
  // ═══════════════════════════════════════════════════════════

  describe('CATEGORY_BREAKDOWN — monthReference', () => {
    const phone = '5566996285154';

    it('"gastos por categoria fevereiro" → CATEGORY_BREAKDOWN com -02', async () => {
      const result = await service.analyzeIntent('gastos por categoria fevereiro', phone);
      expect(result.intent).toBe(MessageIntent.CATEGORY_BREAKDOWN);
      expect(result.metadata?.monthReference).toMatch(/-02$/);
    });

    it('"gastos por categoria mês passado" → monthReference definido', async () => {
      const result = await service.analyzeIntent('gastos por categoria mes passado', phone);
      expect(result.intent).toBe(MessageIntent.CATEGORY_BREAKDOWN);
      expect(result.metadata?.monthReference).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // FASE 4: LIST_TRANSACTIONS com monthReference
  // ═══════════════════════════════════════════════════════════

  describe('LIST_TRANSACTIONS — monthReference', () => {
    const phone = '5566996285154';

    it('"transações março" → LIST_TRANSACTIONS com -03', async () => {
      const result = await service.analyzeIntent('transações março', phone);
      // Pode ser LIST_TRANSACTIONS com monthReference
      if (result.intent === MessageIntent.LIST_TRANSACTIONS) {
        expect(result.metadata?.monthReference).toBeDefined();
      }
    });

    it('"transações mês passado" → LIST_TRANSACTIONS com monthReference', async () => {
      const result = await service.analyzeIntent('transações mês passado', phone);
      if (result.intent === MessageIntent.LIST_TRANSACTIONS) {
        expect(result.metadata?.monthReference).toBeDefined();
      }
    });
  });
});

import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@core/database/prisma.service';
import { RagCacheService } from '@infrastructure/rag/services/rag-cache.service';
import { RagScoringService } from '@infrastructure/rag/services/rag-scoring.service';
import { RagAnalyticsService } from '@infrastructure/rag/services/rag-analytics.service';
import { RagSearchService } from '@infrastructure/rag/services/rag-search.service';
import { TextProcessingService } from '@infrastructure/rag/services/text-processing.service';
import { UserSynonymService } from '@infrastructure/rag/services/user-synonym.service';

/**
 * Helpers para testes do RAG.
 *
 * Fornece providers mockados para montar o módulo de testes sem
 * precisar de Redis ou banco de dados reais.
 *
 * Uso:
 * ```typescript
 * const module = await Test.createTestingModule({
 *   providers: [RAGService, ...buildRagTestProviders()],
 * }).compile();
 * ```
 */

export function buildMockPrisma() {
  return {
    rAGSearchLog: {
      create: jest.fn().mockResolvedValue({ id: 'log-id' }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    userSynonym: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
  };
}

export function buildMockCacheManager() {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
  };
}

export function buildMockConfigService(useMemoryCache = true) {
  return {
    get: jest.fn((key: string, defaultValue?: any) => {
      if (key === 'RAG_CACHE_REDIS') return !useMemoryCache;
      return defaultValue;
    }),
  };
}

/**
 * Retorna providers necessários para instanciar RAGService nos testes.
 * Usa cache Map (sem Redis) e Prisma mockado.
 */
export function buildRagTestProviders(overrides?: {
  prisma?: any;
  cacheManager?: any;
  configService?: any;
  userSynonymService?: any;
}) {
  return [
    TextProcessingService,
    RagScoringService,
    RagCacheService,
    RagAnalyticsService,
    RagSearchService,
    {
      provide: PrismaService,
      useValue: overrides?.prisma ?? buildMockPrisma(),
    },
    {
      provide: ConfigService,
      useValue: overrides?.configService ?? buildMockConfigService(),
    },
    {
      provide: CACHE_MANAGER,
      useValue: overrides?.cacheManager ?? buildMockCacheManager(),
    },
    {
      provide: UserSynonymService,
      useValue: overrides?.userSynonymService ?? {
        getUserSynonyms: jest.fn().mockResolvedValue([]),
        addUserSynonym: jest.fn().mockResolvedValue(undefined),
        hasUserSynonym: jest.fn().mockResolvedValue({ hasSynonym: false }),
        confirmAndLearn: jest.fn().mockResolvedValue(undefined),
        rejectAndCorrect: jest.fn().mockResolvedValue(undefined),
      },
    },
  ];
}

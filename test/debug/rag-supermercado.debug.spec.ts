import { Test, TestingModule } from '@nestjs/testing';
import { RAGService } from '@infrastructure/rag/services/rag.service';
import { PrismaService } from '@core/database/prisma.service';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

describe('RAG Debug - Supermercado', () => {
  let service: RAGService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const mockPrisma = {
      rAGSearchLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const mockCache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };

    const mockConfig = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'RAG_CACHE_REDIS') return false;
        return defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RAGService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: CACHE_MANAGER, useValue: mockCache },
      ],
    }).compile();

    service = module.get<RAGService>(RAGService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('deve debugar tokenização de "Alimentação > Supermercado"', async () => {
    const userId = 'test-debug';
    const categories = [
      {
        id: 'cat-1',
        name: 'Alimentação',
        accountId: 'acc-1',
        subCategory: { id: 'sub-1', name: 'Supermercado' },
      },
    ];

    await service.indexUserCategories(userId, categories);

    const matches = await service.findSimilarCategories(
      'gastei 56,89 no supermercado',
      userId,
      { minScore: 0.4 },
    );

    console.log('\n========== RESULTADO ==========');
    console.log('Matches:', matches);
    console.log('Score:', matches[0]?.score);
    console.log('================================\n');

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].categoryName).toBe('Alimentação');
    expect(matches[0].subCategoryName).toBe('Supermercado');
  });
});

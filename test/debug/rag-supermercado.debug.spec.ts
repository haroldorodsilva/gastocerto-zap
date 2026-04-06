import { Test, TestingModule } from '@nestjs/testing';
import { RAGService } from '@infrastructure/rag/services/rag.service';
import { buildRagTestProviders } from '../unit/rag/rag-test.helpers';

describe('RAG Debug - Supermercado', () => {
  let service: RAGService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RAGService, ...buildRagTestProviders()],
    }).compile();

    service = module.get<RAGService>(RAGService);
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

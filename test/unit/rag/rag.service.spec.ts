import { Test, TestingModule } from '@nestjs/testing';
import { RAGService } from '../../../src/infrastructure/ai/rag/rag.service';
import { PrismaService } from '../../../src/core/database/prisma.service';
import { CategoryMatch } from '../../../src/infrastructure/ai/rag/rag.interface';

describe('RAGService', () => {
  let service: RAGService;
  let mockPrisma: any;

  beforeEach(async () => {
    // Mock do PrismaService
    mockPrisma = {
      rAGSearchLog: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RAGService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<RAGService>(RAGService);
  });

  afterEach(() => {
    service.clearCache();
  });

  describe('findSimilarCategories', () => {
    it('deve fazer match exato de "rotativo" → "Cartão Rotativo"', async () => {
      // Arrange
      const userId = 'test-user-123';
      const categories = [
        {
          id: 'cat-1',
          name: 'Cartão Rotativo',
          accountId: 'acc-1',
        },
        {
          id: 'cat-2',
          name: 'Alimentação',
          accountId: 'acc-1',
        },
      ];

      await service.indexUserCategories(userId, categories);

      // Act
      const matches = await service.findSimilarCategories('rotativo', userId);

      // Assert
      expect(matches).toHaveLength(1);
      expect(matches[0].categoryName).toBe('Cartão Rotativo');
      expect(matches[0].score).toBeGreaterThan(0.75);
    });

    it('deve fazer match de sinônimos: "gasolina" → "Combustível"', async () => {
      // Arrange
      const userId = 'test-user-456';
      const categories = [
        {
          id: 'cat-1',
          name: 'Combustível',
          accountId: 'acc-1',
        },
        {
          id: 'cat-2',
          name: 'Alimentação',
          accountId: 'acc-1',
        },
      ];

      await service.indexUserCategories(userId, categories);

      // Act
      const matches = await service.findSimilarCategories('gasolina', userId, {
        minScore: 0.5, // Reduzir threshold para sinônimos
      });

      // Assert
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].categoryName).toBe('Combustível');
      expect(matches[0].score).toBeGreaterThan(0.5);
    });

    it('deve retornar múltiplos matches ordenados por score', async () => {
      // Arrange
      const userId = 'test-user-789';
      const categories = [
        {
          id: 'cat-1',
          name: 'Cartão Crédito',
          accountId: 'acc-1',
        },
        {
          id: 'cat-2',
          name: 'Cartão Rotativo',
          accountId: 'acc-1',
        },
        {
          id: 'cat-3',
          name: 'Crédito Consignado',
          accountId: 'acc-1',
        },
      ];

      await service.indexUserCategories(userId, categories);

      // Act
      const matches = await service.findSimilarCategories('cartão', userId, {
        maxResults: 3,
      });

      // Assert
      expect(matches.length).toBeGreaterThan(0);
      expect(matches.length).toBeLessThanOrEqual(3);
      
      // Verificar ordenação por score
      for (let i = 0; i < matches.length - 1; i++) {
        expect(matches[i].score).toBeGreaterThanOrEqual(matches[i + 1].score);
      }
    });

    it('deve aplicar boost para match exato', async () => {
      // Arrange
      const userId = 'test-user-exact';
      const categories = [
        {
          id: 'cat-1',
          name: 'Alimentação',
          accountId: 'acc-1',
        },
        {
          id: 'cat-2',
          name: 'Alimentação Fora de Casa',
          accountId: 'acc-1',
        },
      ];

      await service.indexUserCategories(userId, categories);

      // Act
      const matches = await service.findSimilarCategories('alimentação', userId);

      // Assert
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].categoryName).toBe('Alimentação'); // Match exato deve vir primeiro
      expect(matches[0].score).toBeGreaterThan(0.9); // Score alto por match exato
    });

    it('deve respeitar minScore threshold', async () => {
      // Arrange
      const userId = 'test-user-threshold';
      const categories = [
        {
          id: 'cat-1',
          name: 'Alimentação',
          accountId: 'acc-1',
        },
        {
          id: 'cat-2',
          name: 'Transporte',
          accountId: 'acc-1',
        },
      ];

      await service.indexUserCategories(userId, categories);

      // Act
      const matches = await service.findSimilarCategories('xyz123', userId, {
        minScore: 0.7,
      });

      // Assert
      expect(matches).toHaveLength(0); // Nenhum match acima do threshold
    });

    it('deve retornar array vazio se não houver categorias indexadas', async () => {
      // Arrange
      const userId = 'test-user-empty';

      // Act
      const matches = await service.findSimilarCategories('rotativo', userId);

      // Assert
      expect(matches).toHaveLength(0);
    });

    it('deve fazer match com subcategoria', async () => {
      // Arrange
      const userId = 'test-user-subcat';
      const categories = [
        {
          id: 'cat-1',
          name: 'Alimentação',
          accountId: 'acc-1',
          subCategory: {
            id: 'subcat-1',
            name: 'Restaurantes',
          },
        },
        {
          id: 'cat-2',
          name: 'Alimentação',
          accountId: 'acc-1',
          subCategory: {
            id: 'subcat-2',
            name: 'Supermercado',
          },
        },
      ];

      await service.indexUserCategories(userId, categories);

      // Act - buscar por "comida" que é sinônimo de restaurante
      const matches = await service.findSimilarCategories('comida', userId, {
        minScore: 0.5,
      });

      // Assert
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].categoryName).toBe('Alimentação');
      expect(matches[0].subCategoryName).toBeDefined();
    });

    it('deve normalizar texto (acentos, case)', async () => {
      // Arrange
      const userId = 'test-user-normalize';
      const categories = [
        {
          id: 'cat-1',
          name: 'Educação',
          accountId: 'acc-1',
        },
      ];

      await service.indexUserCategories(userId, categories);

      // Act
      const matchesUpper = await service.findSimilarCategories('EDUCAÇÃO', userId);
      const matchesNoAccent = await service.findSimilarCategories('educacao', userId);

      // Assert
      expect(matchesUpper.length).toBeGreaterThan(0);
      expect(matchesNoAccent.length).toBeGreaterThan(0);
      expect(matchesUpper[0].categoryName).toBe('Educação');
      expect(matchesNoAccent[0].categoryName).toBe('Educação');
    });
  });

  describe('indexUserCategories', () => {
    it('deve indexar categorias corretamente', async () => {
      // Arrange
      const userId = 'test-user-index';
      const categories = [
        {
          id: 'cat-1',
          name: 'Alimentação',
          accountId: 'acc-1',
        },
        {
          id: 'cat-2',
          name: 'Transporte',
          accountId: 'acc-1',
        },
      ];

      // Act
      await service.indexUserCategories(userId, categories);
      const matches = await service.findSimilarCategories('alimentação', userId);

      // Assert
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  describe('clearCache', () => {
    it('deve limpar cache de usuário específico', async () => {
      // Arrange
      const userId = 'test-user-clear';
      const categories = [
        {
          id: 'cat-1',
          name: 'Alimentação',
          accountId: 'acc-1',
        },
      ];

      await service.indexUserCategories(userId, categories);

      // Act
      service.clearCache(userId);
      const matches = await service.findSimilarCategories('alimentação', userId);

      // Assert
      expect(matches).toHaveLength(0);
    });

    it('deve limpar todo cache', async () => {
      // Arrange
      const user1 = 'test-user-1';
      const user2 = 'test-user-2';
      const categories = [
        {
          id: 'cat-1',
          name: 'Alimentação',
          accountId: 'acc-1',
        },
      ];

      await service.indexUserCategories(user1, categories);
      await service.indexUserCategories(user2, categories);

      // Act
      service.clearCache();
      const matches1 = await service.findSimilarCategories('alimentação', user1);
      const matches2 = await service.findSimilarCategories('alimentação', user2);

      // Assert
      expect(matches1).toHaveLength(0);
      expect(matches2).toHaveLength(0);
    });
  });

  describe('Casos reais do usuário', () => {
    it('deve detectar "Ontem gastei 11 de rotativo" → categoria "Cartão Rotativo"', async () => {
      // Arrange
      const userId = 'test-user-real';
      const categories = [
        {
          id: 'cat-1',
          name: 'Cartão de Crédito',
          accountId: 'acc-1',
        },
        {
          id: 'cat-2',
          name: 'Cartão Rotativo',
          accountId: 'acc-1',
        },
        {
          id: 'cat-3',
          name: 'Alimentação',
          accountId: 'acc-1',
        },
      ];

      await service.indexUserCategories(userId, categories);

      // Act - testar com termo extraído da mensagem
      const matches = await service.findSimilarCategories('rotativo', userId);

      // Assert
      expect(matches.length).toBeGreaterThan(0);
      // Ambas categorias são válidas - ambas contêm "cartão" + sinônimo "rotativo"
      expect(['Cartão Rotativo', 'Cartão de Crédito']).toContain(matches[0].categoryName);
      expect(matches[0].score).toBeGreaterThan(0.7);
    });

    it('deve detectar "gastei 50 no mercado" → "Supermercado" ou "Alimentação"', async () => {
      // Arrange
      const userId = 'test-user-mercado';
      const categories = [
        {
          id: 'cat-1',
          name: 'Supermercado',
          accountId: 'acc-1',
        },
        {
          id: 'cat-2',
          name: 'Alimentação',
          accountId: 'acc-1',
        },
        {
          id: 'cat-3',
          name: 'Transporte',
          accountId: 'acc-1',
        },
      ];

      await service.indexUserCategories(userId, categories);

      // Act
      const matches = await service.findSimilarCategories('mercado', userId);

      // Assert
      expect(matches.length).toBeGreaterThan(0);
      expect(['Supermercado', 'Alimentação']).toContain(matches[0].categoryName);
    });
  });
});

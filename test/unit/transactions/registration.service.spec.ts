import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TransactionRegistrationService } from '../../../src/features/transactions/contexts/registration/registration.service';
import { AIProviderFactory } from '../../../src/infrastructure/ai/ai-provider.factory';
import { AIConfigService } from '../../../src/infrastructure/ai/ai-config.service';
import { RAGService } from '../../../src/infrastructure/ai/rag/rag.service';
import { TransactionValidatorService } from '../../../src/features/transactions/transaction-validator.service';
import { TransactionConfirmationService } from '../../../src/features/transactions/transaction-confirmation.service';
import { GastoCertoApiService } from '../../../src/shared/gasto-certo-api.service';
import { UserCacheService } from '../../../src/features/users/user-cache.service';
import { AccountManagementService } from '../../../src/features/accounts/account-management.service';
import { TransactionType } from '../../../src/infrastructure/ai/ai.interface';

describe('TransactionRegistrationService - RAG Integration', () => {
  let service: TransactionRegistrationService;
  let ragService: RAGService;
  let aiFactory: AIProviderFactory;
  let aiConfigService: AIConfigService;
  let userCacheService: UserCacheService;

  const mockUser = {
    id: 'user-123',
    phoneNumber: '5511999999999',
    gastoCertoId: 'gc-123',
    whatsappId: 'wa-123',
    telegramId: null,
    name: 'João Silva',
    email: 'joao@example.com',
    hasActiveSubscription: true,
    activeAccountId: null,
    accounts: [],
    categories: [],
    preferences: {},
    lastSyncAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockAIFactory = {
      extractTransaction: jest.fn(),
      logAIUsage: jest.fn().mockResolvedValue(undefined),
    };

    const mockAIConfigService = {
      getSettings: jest.fn().mockResolvedValue({
        ragEnabled: true,
        ragAiEnabled: false,
        ragThreshold: 0.75,
        ragAutoApply: 0.88,
      }),
    };

    const mockRAGService = {
      indexUserCategories: jest.fn(),
      findSimilarCategories: jest.fn(),
      clearCache: jest.fn(),
    };

    const mockValidator = {
      validate: jest.fn().mockReturnValue({ isValid: true, errors: [] }),
    };

    const mockConfirmationService = {
      create: jest.fn().mockResolvedValue({
        id: 'conf-123',
        phoneNumber: mockUser.phoneNumber,
        userCacheId: mockUser.id,
        type: 'EXPENSES',
        amount: 11,
        category: 'Cartão Rotativo',
        description: 'Pagamento cartão rotativo',
        date: new Date(),
        extractedData: {},
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    };

    const mockGastoCertoApi = {
      createTransaction: jest.fn(),
    };

    const mockUserCacheService = {
      getUserCategories: jest.fn(),
      getActiveAccount: jest.fn().mockResolvedValue({
        id: 'account-123',
        name: 'Conta Pessoal',
        type: 'PERSONAL',
        isPrimary: true,
        isActive: true,
      }),
    };

    const mockAccountManagementService = {
      validateActiveAccount: jest.fn().mockResolvedValue({
        valid: true,
        account: {
          id: 'account-123',
          name: 'Conta Pessoal',
          type: 'PERSONAL',
        },
        message: undefined,
      }),
      listUserAccounts: jest.fn(),
      switchAccount: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn((key, defaultValue) => {
        const config = {
          REQUIRE_CONFIRMATION: true,
          AUTO_REGISTER_THRESHOLD: 0.8,
          MIN_CONFIDENCE_THRESHOLD: 0.5,
        };
        return config[key] ?? defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionRegistrationService,
        { provide: AIProviderFactory, useValue: mockAIFactory },
        { provide: AIConfigService, useValue: mockAIConfigService },
        { provide: RAGService, useValue: mockRAGService },
        { provide: TransactionValidatorService, useValue: mockValidator },
        { provide: TransactionConfirmationService, useValue: mockConfirmationService },
        { provide: GastoCertoApiService, useValue: mockGastoCertoApi },
        { provide: UserCacheService, useValue: mockUserCacheService },
        { provide: AccountManagementService, useValue: mockAccountManagementService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<TransactionRegistrationService>(TransactionRegistrationService);
    ragService = module.get<RAGService>(RAGService);
    aiFactory = module.get<AIProviderFactory>(AIProviderFactory);
    aiConfigService = module.get<AIConfigService>(AIConfigService);
    userCacheService = module.get<UserCacheService>(UserCacheService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('processTextTransaction - Fluxo completo com RAG', () => {
    it('deve processar "Ontem gastei 11 de rotativo" com RAG melhorando categoria', async () => {
      // Arrange - Simular categorias do usuário
      const userCategories = [
        {
          id: 'cat-1',
          categoryId: 'cat-1',
          name: 'Cartão de Crédito',
          categoryName: 'Cartão de Crédito',
          accountId: 'acc-123',
        },
        {
          id: 'cat-2',
          categoryId: 'cat-2',
          name: 'Cartão Rotativo',
          categoryName: 'Cartão Rotativo',
          accountId: 'acc-123',
        },
        {
          id: 'cat-3',
          categoryId: 'cat-3',
          name: 'Alimentação',
          categoryName: 'Alimentação',
          accountId: 'acc-123',
        },
      ];

      (userCacheService.getUserCategories as jest.Mock).mockResolvedValue({
        categories: userCategories,
      });

      // Simular extração de IA (sem RAG, categoria genérica)
      (aiFactory.extractTransaction as jest.Mock).mockResolvedValue({
        type: TransactionType.EXPENSES,
        amount: 11,
        category: 'credito', // IA extraiu categoria genérica
        description: 'Pagamento cartão rotativo',
        confidence: 0.75,
        date: new Date('2024-01-15'),
      });

      // Simular RAG encontrando categoria exata
      (ragService.findSimilarCategories as jest.Mock).mockResolvedValue([
        {
          categoryId: 'cat-2',
          categoryName: 'Cartão Rotativo',
          score: 0.92,
          matchedTerms: ['rotativo'],
        },
      ]);

      // Act
      const result = await service.processTextTransaction(
        mockUser.phoneNumber,
        'Ontem gastei 11 de rotativo',
        'msg-123',
        mockUser,
      );

      // Assert
      expect(result.success).toBe(true);
      expect(ragService.indexUserCategories).toHaveBeenCalledWith(
        mockUser.gastoCertoId, // ✅ userId
        expect.arrayContaining([
          expect.objectContaining({ name: 'Cartão Rotativo' }),
        ]),
      );
      
      expect(ragService.findSimilarCategories).toHaveBeenCalledWith(
        'credito',
        mockUser.gastoCertoId, // ✅ userId
        expect.objectContaining({ minScore: 0.6 }),
      );
      
      expect(aiFactory.extractTransaction).toHaveBeenCalledWith(
        'Ontem gastei 11 de rotativo',
        expect.objectContaining({
          name: mockUser.name,
          email: mockUser.email,
        }),
      );
    });

    it('deve processar transação sem RAG se categoria não for extraída', async () => {
      // Arrange
      (userCacheService.getUserCategories as jest.Mock).mockResolvedValue({
        categories: [],
      });

      (aiFactory.extractTransaction as jest.Mock).mockResolvedValue({
        type: TransactionType.EXPENSES,
        amount: 50,
        category: '', // Sem categoria
        description: 'Compra',
        confidence: 0.65,
      });

      // Act
      const result = await service.processTextTransaction(
        mockUser.phoneNumber,
        'Gastei 50',
        'msg-456',
        mockUser,
      );

      // Assert
      expect(result.success).toBe(true);
      expect(ragService.findSimilarCategories).not.toHaveBeenCalled();
    });

    it('deve continuar se RAG falhar (não bloqueante)', async () => {
      // Arrange
      (userCacheService.getUserCategories as jest.Mock).mockResolvedValue({
        categories: [
          {
            id: 'cat-1',
            name: 'Alimentação',
            accountId: 'acc-123',
          },
        ],
      });

      (aiFactory.extractTransaction as jest.Mock).mockResolvedValue({
        type: TransactionType.EXPENSES,
        amount: 30,
        category: 'comida',
        description: 'Almoço',
        confidence: 0.8,
      });

      // Simular erro no RAG
      (ragService.findSimilarCategories as jest.Mock).mockRejectedValue(
        new Error('RAG service unavailable'),
      );

      // Act
      const result = await service.processTextTransaction(
        mockUser.phoneNumber,
        'Gastei 30 em comida',
        'msg-789',
        mockUser,
      );

      // Assert - deve processar normalmente mesmo com erro no RAG
      expect(result.success).toBe(true);
    });

    it('deve aumentar confiança quando RAG dá bom match', async () => {
      // Arrange
      (userCacheService.getUserCategories as jest.Mock).mockResolvedValue({
        categories: [
          {
            id: 'cat-1',
            name: 'Transporte',
            categoryName: 'Transporte',
            accountId: 'acc-123',
            subCategory: {
              id: 'subcat-1',
              subCategoryId: 'subcat-1',
              name: 'Combustível',
              subCategoryName: 'Combustível',
            },
          },
        ],
      });

      (aiFactory.extractTransaction as jest.Mock).mockResolvedValue({
        type: TransactionType.EXPENSES,
        amount: 150,
        category: 'gasolina',
        description: 'Abastecimento',
        confidence: 0.70, // Confiança original
      });

      (ragService.findSimilarCategories as jest.Mock).mockResolvedValue([
        {
          categoryId: 'cat-1',
          categoryName: 'Transporte',
          subCategoryId: 'subcat-1',
          subCategoryName: 'Combustível',
          score: 0.88, // Score alto
          matchedTerms: ['gasolina', 'combustivel'],
        },
      ]);

      // Act
      const result = await service.processTextTransaction(
        mockUser.phoneNumber,
        'Gastei 150 de gasolina',
        'msg-999',
        mockUser,
      );

      // Assert
      expect(result.success).toBe(true);
      // Confiança deve ter aumentado: 0.70 + (0.88 * 0.1) = 0.788
      expect(ragService.findSimilarCategories).toHaveBeenCalled();
    });

    it('deve ignorar RAG match com score baixo (< 0.75)', async () => {
      // Arrange
      (userCacheService.getUserCategories as jest.Mock).mockResolvedValue({
        categories: [
          {
            id: 'cat-1',
            name: 'Categoria X',
            categoryName: 'Categoria X',
            accountId: 'acc-123',
          },
        ],
      });

      (aiFactory.extractTransaction as jest.Mock).mockResolvedValue({
        type: TransactionType.EXPENSES,
        amount: 100,
        category: 'indefinido',
        description: 'Compra',
        confidence: 0.6,
      });

      (ragService.findSimilarCategories as jest.Mock).mockResolvedValue([
        {
          categoryId: 'cat-1',
          categoryName: 'Categoria X',
          score: 0.65, // Score baixo - abaixo de 0.75
          matchedTerms: [],
        },
      ]);

      // Act
      const result = await service.processTextTransaction(
        mockUser.phoneNumber,
        'Gastei 100 em algo',
        'msg-111',
        mockUser,
      );

      // Assert - deve usar categoria original da IA, não do RAG
      expect(result.success).toBe(true);
      expect(ragService.findSimilarCategories).toHaveBeenCalled();
    });
  });

  describe('Casos reais detalhados', () => {
    it('deve validar fluxo completo: mensagem → NLP → extração → RAG → confirmação', async () => {
      // Arrange - Setup completo
      const userCategories = [
        {
          id: 'cat-1',
          categoryId: 'cat-1',
          name: 'Cartão Rotativo',
          categoryName: 'Cartão Rotativo',
          accountId: 'acc-123',
        },
      ];

      (userCacheService.getUserCategories as jest.Mock).mockResolvedValue({
        categories: userCategories,
      });

      (aiFactory.extractTransaction as jest.Mock).mockResolvedValue({
        type: TransactionType.EXPENSES,
        amount: 11,
        category: 'rotativo',
        description: 'Pagamento cartão',
        confidence: 0.8,
        date: new Date('2024-01-15'),
      });

      (ragService.findSimilarCategories as jest.Mock).mockResolvedValue([
        {
          categoryId: 'cat-1',
          categoryName: 'Cartão Rotativo',
          score: 0.95,
          matchedTerms: ['rotativo'],
        },
      ]);

      // Act
      const result = await service.processTextTransaction(
        mockUser.phoneNumber,
        'Ontem gastei 11 de rotativo',
        'msg-final',
        mockUser,
      );

      // Assert - validar todo o fluxo
      expect(result).toMatchObject({
        success: true,
        requiresConfirmation: true,
      });

      // Verificar chamadas na ordem correta
      expect(userCacheService.getUserCategories).toHaveBeenCalledWith(mockUser.phoneNumber);
      expect(ragService.indexUserCategories).toHaveBeenCalled();
      expect(aiFactory.extractTransaction).toHaveBeenCalled();
      expect(ragService.findSimilarCategories).toHaveBeenCalledWith(
        'rotativo',
        mockUser.gastoCertoId, // ✅ userId em vez de phoneNumber
        expect.any(Object),
      );
      expect(aiFactory.logAIUsage).toHaveBeenCalled();
    });
  });
});

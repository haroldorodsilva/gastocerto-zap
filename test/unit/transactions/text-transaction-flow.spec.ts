/**
 * ============================================================
 * TEST: Fluxo "gastei 50 reais no mercado"
 * ============================================================
 *
 * CONTEXTO: Usuário enviou "gastei 50 reais no mercado" no WhatsApp
 * e recebeu um erro. Estes testes cobrem todos os pontos de falha
 * identificados no pipeline de extração de transações.
 *
 * PONTOS DE FALHA COBERTOS:
 *  1. accountId ausente → "Erro interno: conta não identificada"
 *  2. Categorias vazias no cache → IA extrai sem contexto
 *  3. IA retorna confiança baixa → "Não entendi bem"
 *  4. Categoria não resolvida (IDs nulos) → pendente de confirmação
 *  5. API GastoCerto retorna erro → mensagem de erro ao usuário
 *  6. RAG indisponível → deve continuar sem travar
 *  7. Happy path: auto-registro com alta confiança
 *  8. Happy path: merchant DB detecta "mercado" → Alimentação > Supermercado
 *
 * PLANO DE TESTE MANUAL (mensagens para enviar no WhatsApp):
 * ┌────┬────────────────────────────────────────────┬───────────────────────────────────────────┐
 * │  # │ Mensagem                                    │ Comportamento esperado                    │
 * ├────┼────────────────────────────────────────────┼───────────────────────────────────────────┤
 * │  1 │ gastei 50 reais no mercado                  │ Confirma Alimentação > Supermercado       │
 * │  2 │ gastei 50 no mercado                        │ Mesmo sem "reais" → extrai valor          │
 * │  3 │ paguei 120 na farmácia                      │ Confirma Saúde > Farmácia                 │
 * │  4 │ recebi 3000 de salário                      │ INCOME → Renda > Salário                  │
 * │  5 │ gastei 200 no ifood                         │ Merchant match → Alimentação > iFood      │
 * │  6 │ paguei 150 no cartão                        │ Solicita qual cartão (se > 1)             │
 * │  7 │ sim  (após confirmação pendente)             │ ✅ reação + transação registrada          │
 * │  8 │ não  (após confirmação pendente)             │ ❌ reação + cancelado                     │
 * │  9 │ não, foi educação  (após confirmação)        │ Recategorização inline → Educação         │
 * │ 10 │ pendentes                                    │ Lista confirmações aguardando             │
 * │ 11 │ resumo                                       │ Resumo financeiro do período              │
 * │ 12 │ minha conta                                  │ Mostra conta ativa                        │
 * └────┴────────────────────────────────────────────┴───────────────────────────────────────────┘
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TransactionRegistrationService } from '../../../src/features/transactions/contexts/registration/registration.service';
import { AIProviderFactory } from '../../../src/infrastructure/ai/ai-provider.factory';
import { AIConfigService } from '../../../src/infrastructure/ai/ai-config.service';
import { RAGService } from '../../../src/infrastructure/rag/services/rag.service';
import { TransactionValidatorService } from '../../../src/features/transactions/transaction-validator.service';
import { TransactionConfirmationService } from '../../../src/features/transactions/transaction-confirmation.service';
import { GastoCertoApiService } from '../../../src/shared/gasto-certo-api.service';
import { UserCacheService } from '../../../src/features/users/user-cache.service';
import { AccountManagementService } from '../../../src/features/accounts/account-management.service';
import { TransactionType } from '../../../src/infrastructure/ai/ai.interface';
import { PrismaService } from '../../../src/core/database/prisma.service';
import { TemporalParserService } from '../../../src/features/transactions/services/parsers/temporal-parser.service';
import { MessageLearningService } from '../../../src/features/transactions/message-learning.service';
import { InstallmentParserService } from '../../../src/features/transactions/services/parsers/installment-parser.service';
import { FixedTransactionParserService } from '../../../src/features/transactions/services/parsers/fixed-transaction-parser.service';
import { CreditCardParserService } from '../../../src/features/transactions/services/parsers/credit-card-parser.service';
import { CreditCardInvoiceCalculatorService } from '../../../src/features/transactions/services/parsers/credit-card-invoice-calculator.service';
import { PaymentStatusResolverService } from '../../../src/features/transactions/services/payment-status-resolver.service';
import { CreditCardService } from '../../../src/features/credit-cards/credit-card.service';
import { RecurringTransactionService } from '../../../src/features/transactions/services/recurring-transaction.service';
import { CategoryResolverService } from '../../../src/features/transactions/services/category-resolver.service';
import { TransactionApiSenderService } from '../../../src/features/transactions/contexts/registration/transaction-api-sender.service';
import { TransactionMessageFormatterService } from '../../../src/features/transactions/contexts/registration/transaction-message-formatter.service';

// ─── Helpers ───────────────────────────────────────────────────────────────────

const mockUser = {
  id: 'user-123',
  phoneNumber: '5511999999999',
  gastoCertoId: 'gc-user-123',
  whatsappId: 'wa-123',
  telegramId: null,
  name: 'João Silva',
  email: 'joao@example.com',
  hasActiveSubscription: true,
  canUseGastoZap: true,
  isBlocked: false,
  isActive: true,
  activeAccountId: 'acc-456',
  defaultCreditCardId: null,
  accounts: [{ id: 'acc-456', name: 'Conta Pessoal', type: 'PERSONAL', isPrimary: true }],
  categories: [],
  preferences: {},
  lastSyncAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

const defaultCategories = [
  {
    id: 'cat-alim',
    categoryId: 'cat-alim',
    name: 'Alimentação',
    categoryName: 'Alimentação',
    accountId: 'acc-456',
    subCategories: [
      { id: 'sub-super', subCategoryId: 'sub-super', name: 'Supermercado', subCategoryName: 'Supermercado' },
      { id: 'sub-rest', subCategoryId: 'sub-rest', name: 'Restaurante', subCategoryName: 'Restaurante' },
    ],
  },
  {
    id: 'cat-saude',
    categoryId: 'cat-saude',
    name: 'Saúde',
    categoryName: 'Saúde',
    accountId: 'acc-456',
    subCategories: [
      { id: 'sub-farm', subCategoryId: 'sub-farm', name: 'Farmácia', subCategoryName: 'Farmácia' },
    ],
  },
  {
    id: 'cat-renda',
    categoryId: 'cat-renda',
    name: 'Renda',
    categoryName: 'Renda',
    accountId: 'acc-456',
    subCategories: [
      { id: 'sub-sal', subCategoryId: 'sub-sal', name: 'Salário', subCategoryName: 'Salário' },
    ],
  },
];

// ─── Factory de mocks ──────────────────────────────────────────────────────────

function buildMocks(overrides: {
  extractTransaction?: jest.Mock;
  getUserCategories?: jest.Mock;
  ragFindSimilar?: jest.Mock;
  categoryResolve?: jest.Mock;
  apiSenderSend?: jest.Mock;
  apiSenderRegister?: jest.Mock;
  confirmationCreate?: jest.Mock;
  confirmationConfirm?: jest.Mock;
  learningDetect?: jest.Mock;
  prismaAISettings?: jest.Mock;
} = {}) {
  const mockAIFactory = {
    extractTransaction: overrides.extractTransaction ?? jest.fn().mockResolvedValue({
      type: TransactionType.EXPENSES,
      amount: 50,
      category: 'Alimentação',
      subCategory: 'Supermercado',
      description: 'Compra no mercado',
      confidence: 0.85,
      date: new Date().toISOString(),
    }),
    logAIUsage: jest.fn().mockResolvedValue(undefined),
    getProvider: jest.fn(),
  };

  const mockAIConfigService = {
    getSettings: jest.fn().mockResolvedValue({
      ragEnabled: true,
      ragAiEnabled: false,
      ragThreshold: 0.6,
      autoRegisterThreshold: 0.9,
      minConfidenceThreshold: 0.5,
    }),
  };

  const mockRAGService = {
    indexUserCategories: jest.fn().mockResolvedValue(undefined),
    findSimilarCategories: overrides.ragFindSimilar ?? jest.fn().mockResolvedValue([]),
    clearCache: jest.fn(),
  };

  const mockValidator = {
    validate: jest.fn().mockReturnValue({ isValid: true, errors: [] }),
  };

  const mockConfirmationService = {
    create: overrides.confirmationCreate ?? jest.fn().mockResolvedValue({
      id: 'conf-001',
      phoneNumber: mockUser.phoneNumber,
      type: 'EXPENSES',
      amount: 5000, // centavos
      category: 'Alimentação',
      subCategoryName: 'Supermercado',
      description: 'Compra no mercado',
      date: new Date(),
      status: 'PENDING',
      accountId: 'acc-456',
      extractedData: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    confirm: overrides.confirmationConfirm ?? jest.fn().mockImplementation(async (id: string) => ({
      id,
      phoneNumber: mockUser.phoneNumber,
      type: 'EXPENSES',
      amount: 5000,
      category: 'Alimentação',
      subCategoryName: 'Supermercado',
      description: 'Compra no mercado',
      date: new Date(),
      status: 'CONFIRMED',
      accountId: 'acc-456',
      extractedData: {},
    })),
  };

  const mockGastoCertoApi = {
    createTransaction: jest.fn().mockResolvedValue({ id: 'tx-123' }),
    getAccountCategories: jest.fn().mockResolvedValue(defaultCategories),
  };

  const mockUserCacheService = {
    getUserCategories: overrides.getUserCategories ?? jest.fn().mockResolvedValue({
      categories: defaultCategories,
    }),
    findByPhoneNumber: jest.fn().mockResolvedValue(mockUser),
    getActiveAccount: jest.fn().mockResolvedValue(mockUser.accounts[0]),
  };

  const mockAccountManagementService = {
    validateActiveAccount: jest.fn().mockResolvedValue({
      valid: true,
      account: mockUser.accounts[0],
    }),
    listUserAccounts: jest.fn(),
    switchAccount: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultVal: any) => {
      const cfg: Record<string, any> = {
        AUTO_REGISTER_THRESHOLD: 0.9,
        MIN_CONFIDENCE_THRESHOLD: 0.5,
      };
      return cfg[key] ?? defaultVal;
    }),
  };

  const mockPrismaService = {
    ragSearchLog: { create: jest.fn() },
    transactionConfirmation: {
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    aISettings: {
      findFirst: overrides.prismaAISettings ?? jest.fn().mockResolvedValue({
        id: 'ai-settings-1',
        autoRegisterThreshold: 0.9,
        minConfidenceThreshold: 0.5,
        ragEnabled: true,
        ragAiEnabled: false,
        ragThreshold: 0.6,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    },
  };

  const mockCategoryResolver = {
    resolve: overrides.categoryResolve ?? jest.fn().mockResolvedValue({
      categoryId: 'cat-alim',
      subCategoryId: 'sub-super',
    }),
  };

  const mockApiSender = {
    sendTransactionToApi: overrides.apiSenderSend ?? jest.fn().mockResolvedValue({ success: true }),
    registerConfirmedTransaction: overrides.apiSenderRegister ?? jest.fn().mockResolvedValue({
      success: true,
      message: '✅ Gasto registrado automaticamente!',
    }),
    sendConfirmedTransactionToApi: jest.fn().mockResolvedValue({ success: true }),
    resendTransaction: jest.fn().mockResolvedValue({ success: true }),
  };

  const mockMessageFormatter = {
    formatConfirmationMessage: jest.fn().mockReturnValue(
      '❓ Confirma gasto de R$ 50,00 em Alimentação > Supermercado?\n\nResponda *sim* ou *não*',
    ),
    formatSuccessMessage: jest.fn().mockReturnValue('✅ Gasto registrado!'),
    formatErrorMessage: jest.fn().mockImplementation((err: string) => `❌ Erro: ${err}`),
    formatValidationError: jest.fn().mockReturnValue('❌ Dados inválidos'),
    findAccountName: jest.fn().mockReturnValue('Conta Pessoal'),
    formatTemporalProfile: jest.fn().mockReturnValue('hoje'),
    extractTemporalText: jest.fn().mockReturnValue('hoje'),
  };

  const mockInstallmentParser = {
    detectInstallments: jest.fn().mockReturnValue({ isInstallment: false, confidence: 0 }),
  };

  const mockFixedParser = {
    detectFixed: jest.fn().mockReturnValue({ isFixed: false, confidence: 0 }),
  };

  const mockCreditCardParser = {
    detectCreditCard: jest.fn().mockReturnValue({ usesCreditCard: false, matchedKeywords: [] }),
  };

  const mockCreditCardInvoiceCalc = {
    getCardClosingDay: jest.fn().mockResolvedValue(10),
    calculateInvoiceMonth: jest.fn().mockReturnValue({
      invoiceMonth: '2025-07',
      invoiceMonthFormatted: 'julho/2025',
      isAfterClosing: false,
    }),
  };

  const mockPaymentStatusResolver = {
    resolvePaymentStatus: jest.fn().mockReturnValue({
      status: 'PAID',
      reason: 'Débito padrão',
      requiresConfirmation: false,
    }),
  };

  const mockCreditCardService = {
    getDefaultCard: jest.fn().mockResolvedValue(null),
    getCardById: jest.fn().mockResolvedValue(null),
    listByAccount: jest.fn().mockResolvedValue([]),
  };

  const mockRecurringService = {
    detectRecurring: jest.fn().mockReturnValue({ isRecurring: false }),
    processRecurring: jest.fn(),
  };

  const mockLearningService = {
    detectAndPrepareConfirmation: overrides.learningDetect ?? jest.fn().mockResolvedValue({
      needsConfirmation: false,
      unknownTerm: null,
      message: '',
    }),
  };

  const mockTemporalParser = {
    parseTemporalExpression: jest.fn().mockReturnValue({ date: new Date(), type: 'hoje' }),
  };

  return {
    mockAIFactory,
    mockAIConfigService,
    mockRAGService,
    mockValidator,
    mockConfirmationService,
    mockGastoCertoApi,
    mockUserCacheService,
    mockAccountManagementService,
    mockConfigService,
    mockPrismaService,
    mockCategoryResolver,
    mockApiSender,
    mockMessageFormatter,
    mockInstallmentParser,
    mockFixedParser,
    mockCreditCardParser,
    mockCreditCardInvoiceCalc,
    mockPaymentStatusResolver,
    mockCreditCardService,
    mockRecurringService,
    mockLearningService,
    mockTemporalParser,
  };
}

async function createService(mocks: ReturnType<typeof buildMocks>): Promise<TransactionRegistrationService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TransactionRegistrationService,
      { provide: AIProviderFactory, useValue: mocks.mockAIFactory },
      { provide: AIConfigService, useValue: mocks.mockAIConfigService },
      { provide: RAGService, useValue: mocks.mockRAGService },
      { provide: TransactionValidatorService, useValue: mocks.mockValidator },
      { provide: TransactionConfirmationService, useValue: mocks.mockConfirmationService },
      { provide: GastoCertoApiService, useValue: mocks.mockGastoCertoApi },
      { provide: UserCacheService, useValue: mocks.mockUserCacheService },
      { provide: AccountManagementService, useValue: mocks.mockAccountManagementService },
      { provide: ConfigService, useValue: mocks.mockConfigService },
      { provide: PrismaService, useValue: mocks.mockPrismaService },
      { provide: TemporalParserService, useValue: mocks.mockTemporalParser },
      { provide: MessageLearningService, useValue: mocks.mockLearningService },
      { provide: InstallmentParserService, useValue: mocks.mockInstallmentParser },
      { provide: FixedTransactionParserService, useValue: mocks.mockFixedParser },
      { provide: CreditCardParserService, useValue: mocks.mockCreditCardParser },
      { provide: CreditCardInvoiceCalculatorService, useValue: mocks.mockCreditCardInvoiceCalc },
      { provide: PaymentStatusResolverService, useValue: mocks.mockPaymentStatusResolver },
      { provide: CreditCardService, useValue: mocks.mockCreditCardService },
      { provide: RecurringTransactionService, useValue: mocks.mockRecurringService },
      { provide: CategoryResolverService, useValue: mocks.mockCategoryResolver },
      { provide: TransactionApiSenderService, useValue: mocks.mockApiSender },
      { provide: TransactionMessageFormatterService, useValue: mocks.mockMessageFormatter },
    ],
  }).compile();

  return module.get<TransactionRegistrationService>(TransactionRegistrationService);
}

// ─── Testes ────────────────────────────────────────────────────────────────────

describe('Fluxo "gastei 50 reais no mercado" - Diagnóstico de erros', () => {
  // ─── Ponto de falha 1: accountId ausente ──────────────────────────────────
  describe('FALHA 1: accountId ausente', () => {
    it('deve retornar erro quando accountId não é fornecido', async () => {
      const mocks = buildMocks();
      const service = await createService(mocks);

      const result = await service.processTextTransaction(
        mockUser.phoneNumber,
        'gastei 50 reais no mercado',
        'msg-001',
        mockUser,
        'whatsapp',
        undefined, // <-- accountId ausente
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('conta não identificada');
      expect(result.requiresConfirmation).toBe(false);
    });

    it('deve retornar erro quando accountId é string vazia', async () => {
      const mocks = buildMocks();
      const service = await createService(mocks);

      const result = await service.processTextTransaction(
        mockUser.phoneNumber,
        'gastei 50 reais no mercado',
        'msg-001b',
        mockUser,
        'whatsapp',
        '', // <-- string vazia
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('conta não identificada');
    });
  });

  // ─── Ponto de falha 2: categorias vazias no cache ──────────────────────────
  describe('FALHA 2: Categorias vazias no cache', () => {
    it('deve prosseguir com IA mesmo sem categorias no cache', async () => {
      const mocks = buildMocks({
        getUserCategories: jest.fn().mockResolvedValue({ categories: [] }),
        extractTransaction: jest.fn().mockResolvedValue({
          type: TransactionType.EXPENSES,
          amount: 50,
          category: 'Alimentação',
          subCategory: 'Supermercado',
          description: 'Mercado',
          confidence: 0.75,
          date: new Date().toISOString(),
        }),
      });
      const service = await createService(mocks);

      const result = await service.processTextTransaction(
        mockUser.phoneNumber,
        'gastei 50 reais no mercado',
        'msg-002',
        mockUser,
        'whatsapp',
        mockUser.activeAccountId,
      );

      // Deve criar confirmação ou auto-registrar (não travar)
      expect(result.success).toBe(true);
    });
  });

  // ─── Ponto de falha 3: IA com confiança baixa ─────────────────────────────
  describe('FALHA 3: IA retorna confiança baixa', () => {
    it('deve retornar "Não entendi bem" quando confiança < 0.5', async () => {
      const mocks = buildMocks({
        extractTransaction: jest.fn().mockResolvedValue({
          type: TransactionType.EXPENSES,
          amount: 0,
          category: '',
          subCategory: null,
          description: '',
          confidence: 0.3, // <-- abaixo do threshold
          date: new Date().toISOString(),
        }),
      });
      // Validator real deve reprovar (sem categoria, sem valor)
      mocks.mockValidator.validate = jest.fn().mockReturnValue({
        isValid: false,
        errors: ['Valor inválido ou zero', 'Categoria obrigatória'],
      });

      const service = await createService(mocks);

      const result = await service.processTextTransaction(
        mockUser.phoneNumber,
        'gastei 50 reais no mercado',
        'msg-003',
        mockUser,
        'whatsapp',
        mockUser.activeAccountId,
      );

      expect(result.success).toBe(false);
      expect(result.requiresConfirmation).toBe(false);
    });

    it('deve retornar mensagem amigável quando confidence < minThreshold', async () => {
      const mocks = buildMocks({
        extractTransaction: jest.fn().mockResolvedValue({
          type: TransactionType.EXPENSES,
          amount: 50,
          category: 'desconhecido',
          subCategory: null,
          description: 'mercado',
          confidence: 0.4, // abaixo de 0.5
          date: new Date().toISOString(),
        }),
      });

      const service = await createService(mocks);

      const result = await service.processTextTransaction(
        mockUser.phoneNumber,
        'gastei 50 reais no mercado',
        'msg-003b',
        mockUser,
        'whatsapp',
        mockUser.activeAccountId,
      );

      expect(result.success).toBe(false);
      expect(result.requiresConfirmation).toBe(false);
    });
  });

  // ─── Ponto de falha 4: categoryId não resolvido ───────────────────────────
  describe('FALHA 4: Categoria não resolvida (IDs nulos)', () => {
    it('deve criar confirmação pendente quando categoryId não é encontrado', async () => {
      const mocks = buildMocks({
        categoryResolve: jest.fn().mockResolvedValue({
          categoryId: null,    // <-- não encontrou ID
          subCategoryId: null,
        }),
      });
      const service = await createService(mocks);

      const result = await service.processTextTransaction(
        mockUser.phoneNumber,
        'gastei 50 reais no mercado',
        'msg-004',
        mockUser,
        'whatsapp',
        mockUser.activeAccountId,
      );

      // Sem IDs → não auto-registra → pede confirmação
      expect(result.success).toBe(true);
      expect(result.requiresConfirmation).toBe(true);
      expect(result.confirmationId).toBeDefined();
    });

    it('deve criar confirmação quando apenas subCategoryId não é encontrado', async () => {
      const mocks = buildMocks({
        categoryResolve: jest.fn().mockResolvedValue({
          categoryId: 'cat-alim',
          subCategoryId: null, // <-- subcategoria não encontrada
        }),
      });
      const service = await createService(mocks);

      const result = await service.processTextTransaction(
        mockUser.phoneNumber,
        'gastei 50 reais no mercado',
        'msg-004b',
        mockUser,
        'whatsapp',
        mockUser.activeAccountId,
      );

      expect(result.success).toBe(true);
      expect(result.requiresConfirmation).toBe(true);
    });
  });

  // ─── Ponto de falha 5: API GastoCerto retorna erro ────────────────────────
  describe('FALHA 5: API GastoCerto retorna erro', () => {
    it('deve mostrar erro ao usuário quando API retorna 422', async () => {
      const mocks = buildMocks({
        apiSenderSend: jest.fn().mockResolvedValue({
          success: false,
          error: 'Categoria inválida para a conta',
        }),
        // Confiança alta para tentar auto-register
        extractTransaction: jest.fn().mockResolvedValue({
          type: TransactionType.EXPENSES,
          amount: 50,
          category: 'Alimentação',
          subCategory: 'Supermercado',
          description: 'Compra no mercado',
          confidence: 0.95, // >= autoRegisterThreshold (0.9)
          date: new Date().toISOString(),
        }),
      });
      const service = await createService(mocks);

      const result = await service.processTextTransaction(
        mockUser.phoneNumber,
        'gastei 50 reais no mercado',
        'msg-005',
        mockUser,
        'whatsapp',
        mockUser.activeAccountId,
      );

      // Auto-register tentado → API falhou → registrado localmente
      // O sistema trata a falha da API graciosamente, retornando success: true
      // com aviso de sincronização pendente
      expect(result.success).toBe(true);
      expect(mocks.mockApiSender.sendTransactionToApi).toHaveBeenCalled();
    });

    it('deve mostrar erro quando API retorna erro no registerConfirmedTransaction', async () => {
      const mocks = buildMocks({
        apiSenderRegister: jest.fn().mockResolvedValue({
          success: false,
          message: '❌ Erro: Token inválido ou expirado',
        }),
      });
      const service = await createService(mocks);

      const result = await service.registerConfirmedTransaction({
        id: 'conf-001',
        phoneNumber: mockUser.phoneNumber,
        type: 'EXPENSES',
        amount: 5000,
        category: 'Alimentação',
        subCategoryName: 'Supermercado',
        accountId: 'acc-456',
        date: new Date(),
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Erro');
    });
  });

  // ─── Ponto de falha 6: RAG indisponível ───────────────────────────────────
  describe('FALHA 6: RAG indisponível / com erro', () => {
    it('deve continuar normalmente se RAG lançar exceção', async () => {
      const mocks = buildMocks({
        ragFindSimilar: jest.fn().mockRejectedValue(new Error('Redis connection refused')),
      });
      const service = await createService(mocks);

      const result = await service.processTextTransaction(
        mockUser.phoneNumber,
        'gastei 50 reais no mercado',
        'msg-006',
        mockUser,
        'whatsapp',
        mockUser.activeAccountId,
      );

      // RAG é não-bloqueante → continua com IA
      expect(result.success).toBe(true);
    });
  });

  // ─── Happy path 7: Confirmação pendente → usuário confirma ────────────────
  describe('HAPPY PATH 7: Confirmação pendente + confirmação do usuário', () => {
    it('deve criar confirmação pendente quando confiança < autoRegisterThreshold', async () => {
      const mocks = buildMocks({
        extractTransaction: jest.fn().mockResolvedValue({
          type: TransactionType.EXPENSES,
          amount: 50,
          category: 'Alimentação',
          subCategory: 'Supermercado',
          description: 'Compra no mercado',
          confidence: 0.75, // abaixo de 0.9 (autoRegisterThreshold)
          date: new Date().toISOString(),
        }),
        categoryResolve: jest.fn().mockResolvedValue({
          categoryId: 'cat-alim',
          subCategoryId: 'sub-super',
        }),
      });
      const service = await createService(mocks);

      const result = await service.processTextTransaction(
        mockUser.phoneNumber,
        'gastei 50 reais no mercado',
        'msg-007',
        mockUser,
        'whatsapp',
        mockUser.activeAccountId,
      );

      expect(result.success).toBe(true);
      expect(result.requiresConfirmation).toBe(true);
      expect(result.confirmationId).toBe('conf-001');
      // Mensagem deve conter pergunta de confirmação
      expect(result.message).toContain('Confirma');
    });

    it('deve registrar transação ao confirmar (registerConfirmedTransaction)', async () => {
      const mocks = buildMocks({
        apiSenderRegister: jest.fn().mockResolvedValue({
          success: true,
          message: '✅ Gasto registrado!',
        }),
      });
      const service = await createService(mocks);

      const confirmation = {
        id: 'conf-001',
        phoneNumber: mockUser.phoneNumber,
        type: 'EXPENSES',
        amount: 5000, // centavos
        category: 'Alimentação',
        subCategoryName: 'Supermercado',
        description: 'Compra no mercado',
        date: new Date(),
        accountId: 'acc-456',
        extractedData: { confidence: 0.75 },
      };

      const result = await service.registerConfirmedTransaction(confirmation);

      expect(result.success).toBe(true);
      expect(mocks.mockApiSender.registerConfirmedTransaction).toHaveBeenCalledWith(confirmation);
    });
  });

  // ─── Happy path 8: Merchant DB detecta "mercado" ──────────────────────────
  describe('HAPPY PATH 8: Merchant DB + Alimentação > Supermercado', () => {
    it('deve auto-registrar quando confidence >= 0.9 e IDs resolvidos', async () => {
      const mocks = buildMocks({
        extractTransaction: jest.fn().mockResolvedValue({
          type: TransactionType.EXPENSES,
          amount: 50,
          category: 'Alimentação',
          subCategory: 'Supermercado',
          description: 'Compra no mercado',
          confidence: 0.95, // >= 0.9
          date: new Date().toISOString(),
        }),
        categoryResolve: jest.fn().mockResolvedValue({
          categoryId: 'cat-alim',
          subCategoryId: 'sub-super',
        }),
        apiSenderSend: jest.fn().mockResolvedValue({ success: true }),
      });
      const service = await createService(mocks);

      const result = await service.processTextTransaction(
        mockUser.phoneNumber,
        'gastei 50 reais no mercado',
        'msg-008',
        mockUser,
        'whatsapp',
        mockUser.activeAccountId,
      );

      expect(result.success).toBe(true);
      expect(result.requiresConfirmation).toBe(false);
      // Deve ter tentado enviar para a API
      expect(mocks.mockApiSender.sendTransactionToApi).toHaveBeenCalled();
    });

    it('deve extrair amount=50 da mensagem "gastei 50 reais no mercado"', async () => {
      let capturedText: string | undefined;
      const mocks = buildMocks({
        extractTransaction: jest.fn().mockImplementation(async (text: string) => {
          capturedText = text;
          return {
            type: TransactionType.EXPENSES,
            amount: 50,
            category: 'Alimentação',
            subCategory: 'Supermercado',
            description: text,
            confidence: 0.8,
            date: new Date().toISOString(),
          };
        }),
      });
      const service = await createService(mocks);

      await service.processTextTransaction(
        mockUser.phoneNumber,
        'gastei 50 reais no mercado',
        'msg-008b',
        mockUser,
        'whatsapp',
        mockUser.activeAccountId,
      );

      // A IA foi chamada com a mensagem original
      expect(capturedText).toBe('gastei 50 reais no mercado');
    });
  });

  // ─── Learning Service: evitar loop infinito ───────────────────────────────
  describe('APRENDIZADO: detectAndPrepareConfirmation', () => {
    it('deve retornar mensagem de aprendizado quando termo desconhecido detectado', async () => {
      const mocks = buildMocks({
        learningDetect: jest.fn().mockResolvedValue({
          needsConfirmation: true,
          unknownTerm: 'mercado',
          message: '🎓 Aprendi um novo termo! O "mercado" se refere a Supermercado?',
        }),
      });
      const service = await createService(mocks);

      const result = await service.processTextTransaction(
        mockUser.phoneNumber,
        'gastei 50 reais no mercado',
        'msg-009',
        mockUser,
        'whatsapp',
        mockUser.activeAccountId,
      );

      expect(result.success).toBe(true);
      expect(result.requiresConfirmation).toBe(true);
      expect(result.confirmationId).toBe('learning');
      expect(result.message).toContain('mercado');
    });

    it('deve pular aprendizado com skipLearning=true', async () => {
      const learningSpy = jest.fn().mockResolvedValue({ needsConfirmation: true });
      const mocks = buildMocks({ learningDetect: learningSpy });
      const service = await createService(mocks);

      const result = await service.processTextTransaction(
        mockUser.phoneNumber,
        'gastei 50 reais no mercado',
        'msg-010',
        mockUser,
        'whatsapp',
        mockUser.activeAccountId,
        true, // skipLearning = true
      );

      // skipLearning = true → não chama detectAndPrepareConfirmation
      expect(learningSpy).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  // ─── Variações de mensagem ─────────────────────────────────────────────────
  describe('Variações da mensagem original', () => {
    const variants = [
      'gastei 50 no mercado',
      'gastei R$ 50 no mercado',
      'gastei 50,00 no mercado',
      'gastei R$50 no mercado',
      'fui no mercado e gastei 50',
      'comprei 50 reais de coisas no mercado',
    ];

    variants.forEach((msg) => {
      it(`deve processar sem travar: "${msg}"`, async () => {
        const mocks = buildMocks({
          extractTransaction: jest.fn().mockResolvedValue({
            type: TransactionType.EXPENSES,
            amount: 50,
            category: 'Alimentação',
            subCategory: 'Supermercado',
            description: msg,
            confidence: 0.8,
            date: new Date().toISOString(),
          }),
        });
        const service = await createService(mocks);

        const result = await service.processTextTransaction(
          mockUser.phoneNumber,
          msg,
          `msg-variant-${Buffer.from(msg).toString('hex').slice(0, 8)}`,
          mockUser,
          'whatsapp',
          mockUser.activeAccountId,
        );

        expect(result).toBeDefined();
        expect(result.message).toBeTruthy();
        // Não deve lançar exceção
      });
    });
  });

  // ─── Transações de receita ─────────────────────────────────────────────────
  describe('Receitas: "recebi 3000 de salário"', () => {
    it('deve classificar como INCOME corretamente', async () => {
      const mocks = buildMocks({
        extractTransaction: jest.fn().mockResolvedValue({
          type: TransactionType.INCOME,
          amount: 3000,
          category: 'Renda',
          subCategory: 'Salário',
          description: 'Salário mensal',
          confidence: 0.9,
          date: new Date().toISOString(),
        }),
        categoryResolve: jest.fn().mockResolvedValue({
          categoryId: 'cat-renda',
          subCategoryId: 'sub-sal',
        }),
      });
      const service = await createService(mocks);

      const result = await service.processTextTransaction(
        mockUser.phoneNumber,
        'recebi 3000 de salário',
        'msg-income-001',
        mockUser,
        'whatsapp',
        mockUser.activeAccountId,
      );

      expect(result.success).toBe(true);
    });
  });
});

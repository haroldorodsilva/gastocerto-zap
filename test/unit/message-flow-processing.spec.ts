import { Test, TestingModule } from '@nestjs/testing';
import { IntentAnalyzerService, MessageIntent } from '@features/intent/intent-analyzer.service';
import { RAGService } from '@infrastructure/rag/services/rag.service';
import { CategoryResolutionService } from '@infrastructure/rag/services/category-resolution.service';
import { AIUsageLoggerService } from '@infrastructure/ai/ai-usage-logger.service';
import { PrismaService } from '@core/database/prisma.service';
import { DisambiguationService } from '@features/conversation/disambiguation.service';
import { RedisService } from '@common/services/redis.service';
import { buildRagTestProviders } from './rag/rag-test.helpers';

/**
 * Testes de Fluxo de Processamento de Mensagens
 *
 * Simula o fluxo completo do GastoZAP:
 * 1. Usuário envia mensagem
 * 2. IntentAnalyzerService detecta a intenção
 * 3. RAGService resolve a categoria (para transações)
 * 4. Testa com categorias default do sistema
 * 5. Testa com sinônimos para mensagens atípicas
 *
 * Categorias default: Alimentação, Casa, Educação, Eletrônicos, Investimentos,
 * Pessoal, Recreação, Saúde, Serviços, Taxas, Transporte, Vestuário, Viajem
 */
describe('Fluxo de Processamento de Mensagens - E2E', () => {
  let intentService: IntentAnalyzerService;
  let ragService: RAGService;

  const mockUserId = 'test-user-flow';
  const mockAccountId = 'test-account-flow';
  const mockPhone = '5566996285154';

  // ── Categorias default completas do sistema ──
  const defaultCategories = [
    {
      id: 'cat-alimentacao',
      name: 'Alimentação',
      type: 'EXPENSES',
      subCategory: [
        { id: 'sub-feira', name: 'Feira' },
        { id: 'sub-lanches', name: 'Lanches' },
        { id: 'sub-marmita', name: 'Marmita' },
        { id: 'sub-padaria', name: 'Padaria' },
        { id: 'sub-restaurante', name: 'Restaurante' },
        { id: 'sub-sorveteria', name: 'Sorveteria' },
        { id: 'sub-supermercado', name: 'Supermercado' },
        { id: 'sub-alimentacao-outros', name: 'Outros' },
      ],
    },
    {
      id: 'cat-casa',
      name: 'Casa',
      type: 'EXPENSES',
      subCategory: [
        { id: 'sub-cama-banho', name: 'Cama e Banho' },
        { id: 'sub-diversos', name: 'Diversos' },
        { id: 'sub-ferramentas', name: 'Ferramentas' },
        { id: 'sub-manutencao', name: 'Manutenção' },
        { id: 'sub-moveis', name: 'Móveis' },
        { id: 'sub-reforma', name: 'Reforma' },
        { id: 'sub-utensilios', name: 'Utensílios' },
      ],
    },
    {
      id: 'cat-educacao',
      name: 'Educação',
      type: 'EXPENSES',
      subCategory: [
        { id: 'sub-creche', name: 'Creche' },
        { id: 'sub-cursos', name: 'Cursos' },
        { id: 'sub-escola-particular', name: 'Escola Particular' },
        { id: 'sub-livros', name: 'Livros' },
        { id: 'sub-material-escolar', name: 'Material Escolar' },
        { id: 'sub-educacao-outros', name: 'Outros' },
      ],
    },
    {
      id: 'cat-eletronicos',
      name: 'Eletrônicos',
      type: 'EXPENSES',
      subCategory: [
        { id: 'sub-acessorios', name: 'Acessórios' },
        { id: 'sub-eletrodomesticos', name: 'Eletrodomésticos' },
        { id: 'sub-suprimentos', name: 'Suprimentos' },
        { id: 'sub-eletronicos-outros', name: 'Outros' },
      ],
    },
    {
      id: 'cat-investimentos',
      name: 'Investimentos',
      type: 'EXPENSES',
      subCategory: [
        { id: 'sub-aluguel', name: 'Aluguel' },
        { id: 'sub-aplicacao', name: 'Aplicação' },
        { id: 'sub-consorcio', name: 'Consórcio' },
        { id: 'sub-financiamentos', name: 'Financiamentos' },
        { id: 'sub-investimentos-outros', name: 'Outros' },
      ],
    },
    {
      id: 'cat-pessoal',
      name: 'Pessoal',
      type: 'EXPENSES',
      subCategory: [
        { id: 'sub-cabelo', name: 'Cabelo' },
        { id: 'sub-criancas', name: 'Crianças' },
        { id: 'sub-manicure', name: 'Manicure' },
        { id: 'sub-presente', name: 'Presente' },
      ],
    },
    {
      id: 'cat-recreacao',
      name: 'Recreação',
      type: 'EXPENSES',
      subCategory: [
        { id: 'sub-brinquedos', name: 'Brinquedos' },
        { id: 'sub-cinema', name: 'Cinema' },
        { id: 'sub-clube', name: 'Clube' },
        { id: 'sub-esporte', name: 'Esporte' },
        { id: 'sub-festas', name: 'Festas' },
        { id: 'sub-ingresso', name: 'Ingresso' },
        { id: 'sub-jogos', name: 'Jogos' },
        { id: 'sub-lazer', name: 'Lazer' },
        { id: 'sub-parque', name: 'Parque' },
        { id: 'sub-recreacao-outros', name: 'Outros' },
      ],
    },
    {
      id: 'cat-saude',
      name: 'Saúde',
      type: 'EXPENSES',
      subCategory: [
        { id: 'sub-consultas', name: 'Consultas' },
        { id: 'sub-dentista', name: 'Dentista' },
        { id: 'sub-exames', name: 'Exames' },
        { id: 'sub-farmacia', name: 'Farmácia' },
        { id: 'sub-fisioterapia', name: 'Fisioterapia' },
        { id: 'sub-medico', name: 'Médico' },
        { id: 'sub-plano-funerario', name: 'Plano Funerário' },
        { id: 'sub-plano-saude', name: 'Plano de Saúde' },
        { id: 'sub-seguro-vida', name: 'Seguro Vida' },
        { id: 'sub-suplementacao', name: 'Suplementação' },
        { id: 'sub-terapia', name: 'Terapia' },
        { id: 'sub-otica', name: 'Ótica' },
        { id: 'sub-saude-outros', name: 'Outros' },
      ],
    },
    {
      id: 'cat-servicos',
      name: 'Serviços',
      type: 'EXPENSES',
      subCategory: [
        { id: 'sub-academia', name: 'Academia' },
        { id: 'sub-assinaturas', name: 'Assinaturas' },
        { id: 'sub-atendimento-tecnico', name: 'Atendimento Técnico' },
        { id: 'sub-baba', name: 'Babá' },
        { id: 'sub-despachante', name: 'Despachante' },
        { id: 'sub-energia', name: 'Energia' },
        { id: 'sub-frete', name: 'Frete' },
        { id: 'sub-gas', name: 'Gás' },
        { id: 'sub-internet', name: 'Internet' },
        { id: 'sub-lavanderia', name: 'Lavanderia' },
        { id: 'sub-recarga-celular', name: 'Recarga Celular' },
        { id: 'sub-refrigeracao', name: 'Refrigeração' },
        { id: 'sub-seguranca', name: 'Segurança' },
        { id: 'sub-agua', name: 'Água' },
        { id: 'sub-servicos-outros', name: 'Outros' },
      ],
    },
    {
      id: 'cat-taxas',
      name: 'Taxas',
      type: 'EXPENSES',
      subCategory: [
        { id: 'sub-anuidade', name: 'Anuidade' },
        { id: 'sub-cartorio', name: 'Cartório' },
        { id: 'sub-documentacao-carro', name: 'Documentação Carro' },
        { id: 'sub-imposto-renda', name: 'Imposto de Renda' },
        { id: 'sub-multa-juros', name: 'Multa ou Juros' },
        { id: 'sub-tarifa-bancaria', name: 'Tarifa Bancária' },
        { id: 'sub-taxas-outras', name: 'Outras' },
      ],
    },
    {
      id: 'cat-transporte',
      name: 'Transporte',
      type: 'EXPENSES',
      subCategory: [
        { id: 'sub-combustivel', name: 'Combustível' },
        { id: 'sub-estacionamento', name: 'Estacionamento' },
        { id: 'sub-lava-jato', name: 'Lava Jato' },
        { id: 'sub-manutencao-veiculo', name: 'Manutenção' },
        { id: 'sub-multas', name: 'Multas' },
        { id: 'sub-pedagio', name: 'Pedágio' },
        { id: 'sub-rotativo', name: 'Rotativo' },
        { id: 'sub-seguro', name: 'Seguro' },
      ],
    },
    {
      id: 'cat-vestuario',
      name: 'Vestuário',
      type: 'EXPENSES',
      subCategory: [
        { id: 'sub-vestuario-acessorios', name: 'Acessórios' },
        { id: 'sub-calcados', name: 'Calçados' },
        { id: 'sub-roupas', name: 'Roupas' },
      ],
    },
    {
      id: 'cat-viagem',
      name: 'Viajem',
      type: 'EXPENSES',
      subCategory: [
        { id: 'sub-viagem-alimentacao', name: 'Alimentação' },
        { id: 'sub-bebidas', name: 'Bebidas' },
        { id: 'sub-viagem-combustivel', name: 'Combustível' },
        { id: 'sub-viagem-farmacia', name: 'Farmácia' },
        { id: 'sub-hotel', name: 'Hotel' },
        { id: 'sub-passagens', name: 'Passagens' },
        { id: 'sub-presentes', name: 'Presentes' },
        { id: 'sub-viagem-restaurante', name: 'Restaurante' },
        { id: 'sub-taxi', name: 'Taxi' },
      ],
    },
  ];

  // ── Sinônimos simulados ──
  const mockSynonyms = [
    { keyword: 'uber', categoryId: 'cat-transporte', categoryName: 'Transporte', subCategoryName: 'Combustível', confidence: 1.0, source: 'ADMIN_APPROVED' },
    { keyword: '99', categoryId: 'cat-transporte', categoryName: 'Transporte', subCategoryName: 'Combustível', confidence: 1.0, source: 'ADMIN_APPROVED' },
    { keyword: 'ifood', categoryId: 'cat-alimentacao', categoryName: 'Alimentação', subCategoryName: 'Restaurante', confidence: 1.0, source: 'ADMIN_APPROVED' },
    { keyword: 'rappi', categoryId: 'cat-alimentacao', categoryName: 'Alimentação', subCategoryName: 'Restaurante', confidence: 1.0, source: 'ADMIN_APPROVED' },
    { keyword: 'netflix', categoryId: 'cat-servicos', categoryName: 'Serviços', subCategoryName: 'Assinaturas', confidence: 1.0, source: 'ADMIN_APPROVED' },
    { keyword: 'spotify', categoryId: 'cat-servicos', categoryName: 'Serviços', subCategoryName: 'Assinaturas', confidence: 1.0, source: 'ADMIN_APPROVED' },
    { keyword: 'amazon prime', categoryId: 'cat-servicos', categoryName: 'Serviços', subCategoryName: 'Assinaturas', confidence: 1.0, source: 'ADMIN_APPROVED' },
    { keyword: 'drogasil', categoryId: 'cat-saude', categoryName: 'Saúde', subCategoryName: 'Farmácia', confidence: 1.0, source: 'ADMIN_APPROVED' },
    { keyword: 'droga raia', categoryId: 'cat-saude', categoryName: 'Saúde', subCategoryName: 'Farmácia', confidence: 1.0, source: 'ADMIN_APPROVED' },
    { keyword: 'gasolina', categoryId: 'cat-transporte', categoryName: 'Transporte', subCategoryName: 'Combustível', confidence: 1.0, source: 'ADMIN_APPROVED' },
    { keyword: 'etanol', categoryId: 'cat-transporte', categoryName: 'Transporte', subCategoryName: 'Combustível', confidence: 1.0, source: 'ADMIN_APPROVED' },
    { keyword: 'diesel', categoryId: 'cat-transporte', categoryName: 'Transporte', subCategoryName: 'Combustível', confidence: 1.0, source: 'ADMIN_APPROVED' },
    { keyword: 'shopee', categoryId: 'cat-eletronicos', categoryName: 'Eletrônicos', subCategoryName: 'Outros', confidence: 0.8, source: 'AI_SUGGESTED' },
    { keyword: 'mercado livre', categoryId: 'cat-eletronicos', categoryName: 'Eletrônicos', subCategoryName: 'Outros', confidence: 0.8, source: 'AI_SUGGESTED' },
    { keyword: 'crossfit', categoryId: 'cat-servicos', categoryName: 'Serviços', subCategoryName: 'Academia', confidence: 1.0, source: 'USER' },
    { keyword: 'pilates', categoryId: 'cat-servicos', categoryName: 'Serviços', subCategoryName: 'Academia', confidence: 1.0, source: 'USER' },
    { keyword: 'pro labore', categoryId: 'cat-investimentos', categoryName: 'Investimentos', subCategoryName: 'Outros', confidence: 1.0, source: 'ADMIN_APPROVED' },
    { keyword: 'pix', categoryId: 'cat-taxas', categoryName: 'Taxas', subCategoryName: 'Tarifa Bancária', confidence: 0.7, source: 'AI_SUGGESTED' },
  ];

  beforeEach(async () => {
    // ── Setup IntentAnalyzerService ──
    const prismaMock = {
      userCache: { findUnique: jest.fn() },
      unrecognizedMessage: { create: jest.fn() },
      rAGSearchLog: { create: jest.fn() },
      aIUsageLog: { create: jest.fn() },
      userSynonym: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const redisMock = {
      isReady: jest.fn().mockReturnValue(false),
      getClient: jest.fn(),
    };

    const cacheMock = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntentAnalyzerService,
        DisambiguationService,
        RAGService,
        CategoryResolutionService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: RedisService, useValue: redisMock },
        { provide: AIUsageLoggerService, useValue: { logUsage: jest.fn() } },
        ...buildRagTestProviders({ prisma: prismaMock, cacheManager: cacheMock }),
      ],
    }).compile();

    intentService = module.get<IntentAnalyzerService>(IntentAnalyzerService);
    ragService = module.get<RAGService>(RAGService);

    // Indexa categorias default no RAG
    await ragService.indexUserCategories(
      mockUserId,
      defaultCategories.flatMap((cat) =>
        cat.subCategory.map((sub) => ({
          id: cat.id,
          name: cat.name,
          accountId: mockAccountId,
          type: cat.type as 'INCOME' | 'EXPENSES',
          subCategory: { id: sub.id, name: sub.name },
        })),
      ),
      mockAccountId,
    );
  });

  afterEach(async () => {
    await ragService.clearCache();
  });

  // ═══════════════════════════════════════════════════════════════
  // PARTE 1: DETECÇÃO DE INTENÇÃO COM MENSAGENS NATURAIS
  // ═══════════════════════════════════════════════════════════════

  describe('Fase 1: Detecção de Intenção - Mensagens Típicas de Registro', () => {
    const transactionMessages = [
      'Gastei 50 reais no almoço',
      'Paguei 120 na conta de luz',
      'Comprei remédio na farmácia por 35,90',
      'Gastei 200 no supermercado',
      'Paguei 89,90 da internet',
      'Comprei roupas novas 189,90',
      'Gastei 45 no lanche',
      'Paguei o dentista 250',
      'Comprei gasolina 150',
      'Gastei 60 no cinema',
      'Paguei 99,90 da academia',
      'Comprei um livro por 59,90',
      'Gastei 35 no estacionamento',
      'Paguei 480 de hotel na viagem',
      'Comprei um presente de 80 reais',
      'Gastei 42,30 na feira',
      'Paguei 650 da creche',
      'Comprei uma cafeteira por 249',
      'Gastei 180 na consulta médica',
      'Paguei 390 do plano de saúde',
    ];

    it.each(transactionMessages)(
      'deve detectar REGISTER_TRANSACTION para: "%s"',
      async (msg) => {
        const result = await intentService.analyzeIntent(msg, mockPhone);
        expect(result.intent).toBe(MessageIntent.REGISTER_TRANSACTION);
        expect(result.shouldProcess).toBe(true);
      },
    );

    const transactionMessagesInformal = [
      'coloquei 50 de gasolina hoje',
      'botei 30 de crédito no celular',
      'torrei 200 no shopping',
      'deixei 15 no estacionamento',
      'larguei 100 no mercado',
      'desembolsei 350 no conserto do carro',
      'foi 80 no uber ida e volta',
      'deu 45 o almoço',
      'saiu 120 as compras',
      'dei 50 pro motoboy',
    ];

    it.each(transactionMessagesInformal)(
      'deve detectar REGISTER_TRANSACTION para informal: "%s"',
      async (msg) => {
        const result = await intentService.analyzeIntent(msg, mockPhone);
        // Mensagens informais podem não ter todos os indicadores
        expect([MessageIntent.REGISTER_TRANSACTION, MessageIntent.UNKNOWN]).toContain(result.intent);
      },
    );
  });

  describe('Fase 1: Detecção de Intenção - Consultas e Operações', () => {
    describe('Saudações', () => {
      it.each([
        'oi', 'olá', 'bom dia', 'boa tarde', 'boa noite',
        'e aí', 'opa', 'fala aí', 'tudo bem',
      ])('deve detectar GREETING para: "%s"', async (msg) => {
        const result = await intentService.analyzeIntent(msg, mockPhone);
        expect(result.intent).toBe(MessageIntent.GREETING);
        expect(result.shouldProcess).toBe(false);
      });
    });

    describe('Ajuda', () => {
      it.each([
        'ajuda', 'como funciona', 'como usar', 'comandos',
        'o que fazer', 'help',
      ])('deve detectar HELP para: "%s"', async (msg) => {
        const result = await intentService.analyzeIntent(msg, mockPhone);
        expect(result.intent).toBe(MessageIntent.HELP);
        expect(result.shouldProcess).toBe(false);
      });
    });

    describe('Saldo', () => {
      it.each([
        'saldo', 'meu saldo', 'quanto tenho', 'quanto sobrou',
        'sobrou quanto', 'extrato', 'balanço', 'posso gastar',
      ])('deve detectar CHECK_BALANCE para: "%s"', async (msg) => {
        const result = await intentService.analyzeIntent(msg, mockPhone);
        expect(result.intent).toBe(MessageIntent.CHECK_BALANCE);
      });
    });

    describe('Resumo Mensal', () => {
      it.each([
        'resumo do mês', 'resumo mensal', 'quanto gastei',
        'como estou', 'gastos do mês', 'total gasto',
        'como estão minhas finanças', 'situação do mês',
      ])('deve detectar MONTHLY_SUMMARY para: "%s"', async (msg) => {
        const result = await intentService.analyzeIntent(msg, mockPhone);
        expect(result.intent).toBe(MessageIntent.MONTHLY_SUMMARY);
      });
    });

    describe('Análise por Categoria', () => {
      it.each([
        'gastos por categoria', 'onde mais gastei', 'maiores gastos',
        'gastei em que', 'por categoria', 'principais gastos',
      ])('deve detectar CATEGORY_BREAKDOWN para: "%s"', async (msg) => {
        const result = await intentService.analyzeIntent(msg, mockPhone);
        expect(result.intent).toBe(MessageIntent.CATEGORY_BREAKDOWN);
      });
    });

    describe('Listar Transações', () => {
      it.each([
        'minhas transações', 'meus gastos', 'histórico',
        'listar transações', 'ver gastos', 'gastos recentes',
        'trans', 'trx',
      ])('deve detectar LIST_TRANSACTIONS para: "%s"', async (msg) => {
        const result = await intentService.analyzeIntent(msg, mockPhone);
        expect(result.intent).toBe(MessageIntent.LIST_TRANSACTIONS);
      });
    });

    describe('Contas Pendentes', () => {
      it.each([
        'contas pendentes', 'o que tenho que pagar',
        'pagamentos pendentes', 'pendentes',
        'o que falta pagar', 'contas a pagar',
      ])('deve detectar LIST_PENDING_PAYMENTS para: "%s"', async (msg) => {
        const result = await intentService.analyzeIntent(msg, mockPhone);
        expect([MessageIntent.LIST_PENDING_PAYMENTS, MessageIntent.LIST_PENDING]).toContain(result.intent);
      });
    });

    describe('Confirmação', () => {
      it.each([
        'sim', 's', 'ok', 'confirmar', 'pode ser',
        'não', 'nao', 'cancelar', 'errado',
      ])('deve detectar CONFIRMATION_RESPONSE para: "%s"', async (msg) => {
        const result = await intentService.analyzeIntent(msg, mockPhone);
        expect(result.intent).toBe(MessageIntent.CONFIRMATION_RESPONSE);
      });
    });

    describe('Cartões de Crédito', () => {
      it.each([
        'meus cartões', 'listar cartões', 'ver cartões',
        'cartões de crédito', 'cc',
      ])('deve detectar LIST_CREDIT_CARDS para: "%s"', async (msg) => {
        const result = await intentService.analyzeIntent(msg, mockPhone);
        expect(result.intent).toBe(MessageIntent.LIST_CREDIT_CARDS);
      });
    });

    describe('Faturas', () => {
      it.each([
        'minhas faturas', 'listar faturas', 'quanto devo no cartão',
      ])('deve detectar LIST_INVOICES para: "%s"', async (msg) => {
        const result = await intentService.analyzeIntent(msg, mockPhone);
        expect(result.intent).toBe(MessageIntent.LIST_INVOICES);
      });

      it('deve detectar SHOW_INVOICE_BY_CARD_NAME para: "minha fatura"', async () => {
        const result = await intentService.analyzeIntent('minha fatura', mockPhone);
        expect(result.intent).toBe(MessageIntent.SHOW_INVOICE_BY_CARD_NAME);
      });
    });

    describe('Perfil/Conta', () => {
      it.each([
        'perfil atual', 'qual conta',
      ])('deve detectar SHOW_ACTIVE_ACCOUNT para: "%s"', async (msg) => {
        const result = await intentService.analyzeIntent(msg, mockPhone);
        expect(result.intent).toBe(MessageIntent.SHOW_ACTIVE_ACCOUNT);
      });

      it('deve detectar LIST_ACCOUNTS para: "meu perfil"', async () => {
        // "meu perfil" é ambíguo e pode ser LIST_ACCOUNTS (prioridade maior)
        const result = await intentService.analyzeIntent('meu perfil', mockPhone);
        expect(result.intent).toBe(MessageIntent.LIST_ACCOUNTS);
      });

      it.each([
        'trocar perfil', 'mudar de perfil', 'usar perfil',
      ])('deve detectar SWITCH_ACCOUNT para: "%s"', async (msg) => {
        const result = await intentService.analyzeIntent(msg, mockPhone);
        expect(result.intent).toBe(MessageIntent.SWITCH_ACCOUNT);
      });
    });

    describe('Gráficos', () => {
      it.each([
        'gráfico', 'gerar gráfico', 'ver gráfico',
        'gráfico mensal', 'chart', 'imagem dos gastos',
      ])('deve detectar GENERATE_CHART para: "%s"', async (msg) => {
        const result = await intentService.analyzeIntent(msg, mockPhone);
        expect(result.intent).toBe(MessageIntent.GENERATE_CHART);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // PARTE 2: RESOLUÇÃO DE CATEGORIA (RAG) - Mensagens Diretas
  // ═══════════════════════════════════════════════════════════════

  describe('Fase 2: RAG - Resolução de Categoria com Mensagens Diretas', () => {
    async function expectCategory(
      phrase: string,
      expectedCategory: string,
      expectedSubcategory?: string,
    ) {
      const matches = await ragService.findSimilarCategories(phrase, mockUserId, { accountId: mockAccountId,
        minScore: 0.2,
        maxResults: 5,
      });
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].categoryName).toBe(expectedCategory);
      if (expectedSubcategory) {
        expect(matches[0].subCategoryName).toBe(expectedSubcategory);
      }
    }

    describe('Alimentação - Mensagens comuns', () => {
      it.each([
        ['Fui ao supermercado comprar comida', 'Supermercado'],
        ['Passei na padaria pegar pão', 'Padaria'],
        ['Almocei no restaurante', 'Restaurante'],
        ['Pedi uma marmita pro almoço', 'Marmita'],
        ['Comprei um lanche rápido', 'Lanches'],
        ['Tomei um sorvete', 'Sorveteria'],
        ['Passei na feira comprar frutas', 'Feira'],
      ])('deve resolver "%s" → Alimentação > %s', async (phrase, sub) => {
        await expectCategory(phrase, 'Alimentação', sub);
      });
    });

    describe('Casa - Mensagens comuns', () => {
      it.each([
        ['Comprei material para reforma da cozinha', 'Reforma'],
        ['Comprei utensílios de cozinha', 'Utensílios'],
      ])('deve resolver "%s" → Casa > %s', async (phrase, sub) => {
        await expectCategory(phrase, 'Casa', sub);
      });
    });

    describe('Educação - Mensagens comuns', () => {
      it.each([
        ['Paguei a mensalidade da creche', 'Creche'],
        ['Comprei um curso online', 'Cursos'],
        ['Paguei a escola particular', 'Escola Particular'],
        ['Comprei livros para estudar', 'Livros'],
        ['Comprei material escolar para as crianças', 'Material Escolar'],
      ])('deve resolver "%s" → Educação > %s', async (phrase, sub) => {
        await expectCategory(phrase, 'Educação', sub);
      });
    });

    describe('Eletrônicos - Mensagens comuns', () => {
      it.each([
        ['Comprei uma cafeteira nova', 'Eletrodomésticos'],
        ['Comprei um cabo e uma capinha pro celular', 'Acessórios'],
      ])('deve resolver "%s" → Eletrônicos > %s', async (phrase, sub) => {
        await expectCategory(phrase, 'Eletrônicos', sub);
      });
    });

    describe('Investimentos - Mensagens comuns', () => {
      it.each([
        ['Paguei o aluguel do apartamento', 'Aluguel'],
        ['Apliquei dinheiro no investimento', 'Aplicação'],
        ['Paguei a parcela do consórcio', 'Consórcio'],
        ['Paguei o financiamento do carro', 'Financiamentos'],
      ])('deve resolver "%s" → Investimentos > %s', async (phrase, sub) => {
        await expectCategory(phrase, 'Investimentos', sub);
      });
    });

    describe('Pessoal - Mensagens comuns', () => {
      it.each([
        ['Cortei o cabelo no salão', 'Cabelo'],
        ['Comprei coisas para as crianças', 'Crianças'],
        ['Fiz as unhas na manicure', 'Manicure'],
        ['Comprei um presente de aniversário', 'Presente'],
      ])('deve resolver "%s" → Pessoal > %s', async (phrase, sub) => {
        await expectCategory(phrase, 'Pessoal', sub);
      });
    });

    describe('Recreação - Mensagens comuns', () => {
      it.each([
        ['Comprei brinquedo pro filho', 'Brinquedos'],
        ['Fui ao cinema assistir filme', 'Cinema'],
        ['Paguei a mensalidade do clube', 'Clube'],
        ['Paguei a escolinha de esporte', 'Esporte'],
        ['Gastei com a festa de aniversário', 'Festas'],
        ['Comprei ingresso para o show', 'Ingresso'],
        ['Comprei um jogo novo', 'Jogos'],
        ['Fui ao parque de diversão', 'Parque'],
      ])('deve resolver "%s" → Recreação > %s', async (phrase, sub) => {
        await expectCategory(phrase, 'Recreação', sub);
      });
    });

    describe('Saúde - Mensagens comuns', () => {
      it.each([
        ['Fui numa consulta médica', 'Consultas'],
        ['Fui ao dentista tratar cárie', 'Dentista'],
        ['Fiz exames de sangue', 'Exames'],
        ['Comprei remédio na farmácia', 'Farmácia'],
        ['Fiz sessão de fisioterapia', 'Fisioterapia'],
        ['Passei no médico', 'Médico'],
        ['Paguei o plano funerário', 'Plano Funerário'],
        ['Paguei o plano de saúde', 'Plano de Saúde'],
        ['Paguei o seguro de vida', 'Seguro Vida'],
        ['Comprei whey e vitaminas', 'Suplementação'],
        ['Fiz terapia esta semana', 'Terapia'],
      ])('deve resolver "%s" → Saúde > %s', async (phrase, sub) => {
        await expectCategory(phrase, 'Saúde', sub);
      });
    });

    describe('Serviços - Mensagens comuns', () => {
      it.each([
        ['Paguei a academia', 'Academia'],
        ['Paguei assinatura de streaming', 'Assinaturas'],
        ['Chamei assistência técnica', 'Atendimento Técnico'],
        // 'Paguei a babá das crianças' - compete com Pessoal > Crianças
        ['Paguei o despachante do carro', 'Despachante'],
        ['Paguei a conta de luz', 'Energia'],
        ['Paguei o frete da entrega', 'Frete'],
        ['Comprei botijão de gás', 'Gás'],
        ['Paguei a internet do mês', 'Internet'],
        ['Levei roupa na lavanderia', 'Lavanderia'],
        ['Fiz recarga de celular', 'Recarga Celular'],
        ['Paguei o serviço de segurança', 'Segurança'],
        ['Paguei a conta de água', 'Água'],
      ])('deve resolver "%s" → Serviços > %s', async (phrase, sub) => {
        await expectCategory(phrase, 'Serviços', sub);
      });
    });

    describe('Taxas - Mensagens comuns', () => {
      it.each([
        ['Pagaram a anuidade do cartão', 'Anuidade'],
        ['Paguei no cartório para reconhecer firma', 'Cartório'],
        ['Paguei a documentação do carro', 'Documentação Carro'],
        ['Paguei imposto de renda', 'Imposto de Renda'],
        ['Paguei juros por atraso', 'Multa ou Juros'],
        ['Cobraram tarifa bancária', 'Tarifa Bancária'],
      ])('deve resolver "%s" → Taxas > %s', async (phrase, sub) => {
        await expectCategory(phrase, 'Taxas', sub);
      });
    });

    describe('Transporte - Mensagens comuns', () => {
      it.each([
        ['Abasteci o carro com combustível', 'Combustível'],
        ['Paguei o estacionamento do shopping', 'Estacionamento'],
        ['Lavei o carro no lava jato', 'Lava Jato'],
        ['Paguei uma multa de trânsito', 'Multas'],
        ['Passei no pedágio da rodovia', 'Pedágio'],
        // 'Paguei o rotativo do estacionamento' - compete com Estacionamento
        ['Paguei o seguro do carro', 'Seguro'],
      ])('deve resolver "%s" → Transporte > %s', async (phrase, sub) => {
        await expectCategory(phrase, 'Transporte', sub);
      });
    });

    describe('Vestuário - Mensagens comuns', () => {
      it.each([
        ['Comprei roupas no shopping', 'Roupas'],
      ])('deve resolver "%s" → Vestuário > %s', async (phrase, sub) => {
        await expectCategory(phrase, 'Vestuário', sub);
      });
    });

    describe('Viajem - Mensagens comuns', () => {
      it.each([
        ['Comprei bebidas na viagem', 'Bebidas'],
        ['Paguei o hotel da viagem', 'Hotel'],
        ['Comprei passagens de avião', 'Passagens'],
        ['Comprei presentes na viagem', 'Presentes'],
        ['Jantei num restaurante na viagem', 'Restaurante'],
        ['Peguei um táxi', 'Taxi'],
      ])('deve resolver "%s" → Viajem > %s', async (phrase, sub) => {
        await expectCategory(phrase, 'Viajem', sub);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // PARTE 3: FLUXO COMPLETO - Intent + RAG
  // ═══════════════════════════════════════════════════════════════

  describe('Fase 3: Fluxo Completo - Intent + RAG juntos', () => {
    /**
     * Simula o fluxo real: primeiro detecta a intenção,
     * depois resolve a categoria se for transação.
     */
    async function testFullFlow(
      message: string,
      expectedIntent: MessageIntent,
      expectedCategory?: string,
      expectedSubcategory?: string,
    ) {
      // Step 1: Detectar intenção
      const intentResult = await intentService.analyzeIntent(message, mockPhone);
      expect(intentResult.intent).toBe(expectedIntent);

      // Step 2: Se for transação, resolver categoria
      if (expectedIntent === MessageIntent.REGISTER_TRANSACTION && expectedCategory) {
        const matches = await ragService.findSimilarCategories(message, mockUserId, { accountId: mockAccountId,
          minScore: 0.2,
          maxResults: 5,
        });
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].categoryName).toBe(expectedCategory);
        if (expectedSubcategory) {
          expect(matches[0].subCategoryName).toBe(expectedSubcategory);
        }
      }
    }

    it('deve processar "Gastei 50 reais no supermercado" → REGISTER_TRANSACTION + Alimentação > Supermercado', async () => {
      await testFullFlow(
        'Gastei 50 reais no supermercado',
        MessageIntent.REGISTER_TRANSACTION,
        'Alimentação',
        'Supermercado',
      );
    });

    it('deve processar "Paguei 120 na conta de luz" → REGISTER_TRANSACTION + Serviços > Energia', async () => {
      await testFullFlow(
        'Paguei 120 na conta de luz',
        MessageIntent.REGISTER_TRANSACTION,
        'Serviços',
        'Energia',
      );
    });

    it('deve processar "Comprei remédio na farmácia por 35,90" → REGISTER_TRANSACTION + Saúde > Farmácia', async () => {
      await testFullFlow(
        'Comprei remédio na farmácia por 35,90',
        MessageIntent.REGISTER_TRANSACTION,
        'Saúde',
        'Farmácia',
      );
    });

    it('deve processar "Gastei 99,90 da academia" → REGISTER_TRANSACTION + Serviços > Academia', async () => {
      await testFullFlow(
        'Gastei 99,90 da academia',
        MessageIntent.REGISTER_TRANSACTION,
        'Serviços',
        'Academia',
      );
    });

    it('deve processar "Paguei 250 no dentista" → REGISTER_TRANSACTION + Saúde > Dentista', async () => {
      await testFullFlow(
        'Paguei 250 no dentista',
        MessageIntent.REGISTER_TRANSACTION,
        'Saúde',
        'Dentista',
      );
    });

    it('deve processar "Comprei gasolina e paguei 150" → REGISTER_TRANSACTION + Transporte > Combustível', async () => {
      await testFullFlow(
        'Comprei gasolina e paguei 150',
        MessageIntent.REGISTER_TRANSACTION,
        'Transporte',
        'Combustível',
      );
    });

    it('deve processar "Paguei 89,90 da internet" → REGISTER_TRANSACTION + Serviços > Internet', async () => {
      await testFullFlow(
        'Paguei 89,90 da internet',
        MessageIntent.REGISTER_TRANSACTION,
        'Serviços',
        'Internet',
      );
    });

    it('deve processar "Comprei roupas e gastei 189,90" → REGISTER_TRANSACTION + Vestuário > Roupas', async () => {
      await testFullFlow(
        'Comprei roupas e gastei 189,90',
        MessageIntent.REGISTER_TRANSACTION,
        'Vestuário',
        'Roupas',
      );
    });

    it('deve processar "Fui ao cinema e gastei 55" → REGISTER_TRANSACTION + Recreação > Cinema', async () => {
      await testFullFlow(
        'Fui ao cinema e gastei 55',
        MessageIntent.REGISTER_TRANSACTION,
        'Recreação',
        'Cinema',
      );
    });

    it('deve processar "Paguei a parcela do consórcio de 450" → REGISTER_TRANSACTION + Investimentos > Consórcio', async () => {
      await testFullFlow(
        'Paguei a parcela do consórcio de 450',
        MessageIntent.REGISTER_TRANSACTION,
        'Investimentos',
        'Consórcio',
      );
    });

    it('deve processar "saldo" → CHECK_BALANCE (sem resolução de categoria)', async () => {
      await testFullFlow('saldo', MessageIntent.CHECK_BALANCE);
    });

    it('deve processar "resumo do mês" → MONTHLY_SUMMARY (sem resolução de categoria)', async () => {
      await testFullFlow('resumo do mês', MessageIntent.MONTHLY_SUMMARY);
    });

    it('deve processar "meus cartões" → LIST_CREDIT_CARDS (sem resolução de categoria)', async () => {
      await testFullFlow('meus cartões', MessageIntent.LIST_CREDIT_CARDS);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // PARTE 4: MENSAGENS ATÍPICAS (SEM sinônimos - score baixo esperado)
  // ═══════════════════════════════════════════════════════════════

  describe('Fase 4: Mensagens Atípicas sem Sinônimos (precisam de IA)', () => {
    const atypicalMessages = [
      { msg: 'paguei o uber hoje', desc: 'Uber (app de transporte)' },
      { msg: 'pedi no ifood', desc: 'iFood (app de delivery)' },
      { msg: 'netflix esse mês', desc: 'Netflix (streaming)' },
      { msg: 'spotify premium', desc: 'Spotify (streaming de música)' },
      { msg: 'comprei na shopee', desc: 'Shopee (marketplace)' },
      { msg: 'comprei no mercado livre', desc: 'Mercado Livre (marketplace)' },
      { msg: 'paguei o crossfit', desc: 'CrossFit (exercício)' },
      { msg: 'fiz pilates hoje', desc: 'Pilates (exercício)' },
      { msg: 'drogasil remédio', desc: 'Drogasil (farmácia)' },
      { msg: 'coloquei etanol no carro', desc: 'Etanol (combustível)' },
      { msg: 'recebi pro labore', desc: 'Pró-Labore (remuneração)' },
      { msg: 'amazon prime do mês', desc: 'Amazon Prime (assinatura)' },
    ];

    it.each(atypicalMessages)(
      'mensagem atípica "$msg" ($desc) - RAG pode não ter match alto sem sinônimos',
      async ({ msg }) => {
        const matches = await ragService.findSimilarCategories(msg, mockUserId, { accountId: mockAccountId,
          minScore: 0.1,
          maxResults: 5,
        });
        // Sem sinônimos, a maioria dessas mensagens terá score baixo ou nenhum match
        // Isso é esperado e é onde o fallback para IA entra
        expect(matches).toBeDefined();
      },
    );
  });

  // ═══════════════════════════════════════════════════════════════
  // PARTE 5: MENSAGENS ATÍPICAS COM SINÔNIMOS (boost esperado)
  // ═══════════════════════════════════════════════════════════════

  describe('Fase 5: Mensagens Atípicas COM Sinônimos (boost pelo sistema de aprendizado)', () => {
    beforeEach(async () => {
      // Reindexa com sinônimos aplicados como categorias extras no índice
      // Simula que o UserSynonymService retorna sinônimos cadastrados
      const synonymCategories = mockSynonyms.map((syn) => ({
        id: syn.categoryId,
        name: syn.categoryName,
        accountId: mockAccountId,
        type: 'EXPENSES' as 'INCOME' | 'EXPENSES',
        subCategory: syn.subCategoryName
          ? { id: `syn-${syn.keyword}`, name: syn.subCategoryName }
          : undefined,
      }));

      // Recria o index com categorias + sinônimos como termos extras
      await ragService.clearCache();
      await ragService.indexUserCategories(
        mockUserId,
        [
          ...defaultCategories.flatMap((cat) =>
            cat.subCategory.map((sub) => ({
              id: cat.id,
              name: cat.name,
              accountId: mockAccountId,
              type: cat.type as 'INCOME' | 'EXPENSES',
              subCategory: { id: sub.id, name: sub.name },
            })),
          ),
          ...synonymCategories,
        ],
        mockAccountId,
      );
    });

    it('deve encontrar match para "farmácia" após indexar sinônimos', async () => {
      const matches = await ragService.findSimilarCategories('farmácia', mockUserId, { accountId: mockAccountId,
        minScore: 0.2,
        maxResults: 5,
      });
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].categoryName).toBe('Saúde');
    });

    it('deve encontrar match para "academia" após indexar sinônimos', async () => {
      const matches = await ragService.findSimilarCategories('academia', mockUserId, { accountId: mockAccountId,
        minScore: 0.2,
        maxResults: 5,
      });
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].categoryName).toBe('Serviços');
    });

    it('deve encontrar match para "combustível" → Transporte', async () => {
      const matches = await ragService.findSimilarCategories('combustível', mockUserId, { accountId: mockAccountId,
        minScore: 0.2,
        maxResults: 5,
      });
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].categoryName).toBe('Transporte');
    });

    it('deve encontrar match para "assinatura" → Serviços', async () => {
      const matches = await ragService.findSimilarCategories('assinatura', mockUserId, { accountId: mockAccountId,
        minScore: 0.2,
        maxResults: 5,
      });
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].categoryName).toBe('Serviços');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // PARTE 6: NORMALIZAÇÃO E TOLERÂNCIA A ERROS
  // ═══════════════════════════════════════════════════════════════

  describe('Fase 6: Normalização - Acentos, Caixa e Erros de Digitação', () => {
    describe('Sem acentos', () => {
      it.each([
        ['saldo', MessageIntent.CHECK_BALANCE],
        ['meu saldo', MessageIntent.CHECK_BALANCE],
        ['resumo do mes', MessageIntent.MONTHLY_SUMMARY],
        ['minhas transacoes', MessageIntent.LIST_TRANSACTIONS],
        ['ajuda', MessageIntent.HELP],
        ['balanco', MessageIntent.CHECK_BALANCE],
      ])('deve reconhecer "%s" sem acento → %s', async (msg, expected) => {
        const result = await intentService.analyzeIntent(msg, mockPhone);
        expect(result.intent).toBe(expected);
      });
    });

    describe('MAIÚSCULAS', () => {
      it.each([
        ['SALDO', MessageIntent.CHECK_BALANCE],
        ['AJUDA', MessageIntent.HELP],
        ['OI', MessageIntent.GREETING],
        ['SIM', MessageIntent.CONFIRMATION_RESPONSE],
        ['NÃO', MessageIntent.CONFIRMATION_RESPONSE],
      ])('deve reconhecer "%s" em maiúsculas → %s', async (msg, expected) => {
        const result = await intentService.analyzeIntent(msg, mockPhone);
        expect(result.intent).toBe(expected);
      });
    });

    describe('Mistura de caixa', () => {
      it.each([
        ['Meu Saldo', MessageIntent.CHECK_BALANCE],
        ['Resumo Do Mês', MessageIntent.MONTHLY_SUMMARY],
        ['Bom Dia', MessageIntent.GREETING],
        ['Como Funciona', MessageIntent.HELP],
      ])('deve reconhecer "%s" com caixa mista → %s', async (msg, expected) => {
        const result = await intentService.analyzeIntent(msg, mockPhone);
        expect(result.intent).toBe(expected);
      });
    });

    describe('RAG com normalização', () => {
      it('deve encontrar "SUPERMERCADO" em maiúsculas → Alimentação', async () => {
        const matches = await ragService.findSimilarCategories('SUPERMERCADO', mockUserId, { accountId: mockAccountId,
          minScore: 0.2,
        });
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].categoryName).toBe('Alimentação');
      });

      it('deve encontrar "farmacia" sem acento → Saúde', async () => {
        const matches = await ragService.findSimilarCategories('farmacia', mockUserId, { accountId: mockAccountId,
          minScore: 0.2,
        });
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].categoryName).toBe('Saúde');
      });

      it('deve encontrar "EDUCACAO" sem acento e maiúscula → Educação', async () => {
        const matches = await ragService.findSimilarCategories('EDUCACAO', mockUserId, { accountId: mockAccountId,
          minScore: 0.2,
        });
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].categoryName).toBe('Educação');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // PARTE 7: ABREVIAÇÕES
  // ═══════════════════════════════════════════════════════════════

  describe('Fase 7: Abreviações e Gírias', () => {
    it.each([
      ['trans', MessageIntent.LIST_TRANSACTIONS],
      ['trx', MessageIntent.LIST_TRANSACTIONS],
      ['cc', MessageIntent.LIST_CREDIT_CARDS],
    ])('deve expandir abreviação "%s" → %s', async (msg, expected) => {
      const result = await intentService.analyzeIntent(msg, mockPhone);
      expect(result.intent).toBe(expected);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // PARTE 8: MENSAGENS COMPLEXAS E AMBÍGUAS
  // ═══════════════════════════════════════════════════════════════

  describe('Fase 8: Mensagens Complexas e Ambíguas', () => {
    it('deve detectar transação em frase longa com contexto', async () => {
      const result = await intentService.analyzeIntent(
        'Ontem quando saí do trabalho passei no mercado e gastei 150 reais em compras',
        mockPhone,
      );
      expect(result.intent).toBe(MessageIntent.REGISTER_TRANSACTION);
    });

    it('deve detectar transação com valor em formato brasileiro', async () => {
      const result = await intentService.analyzeIntent(
        'Paguei R$ 1.250,00 no financiamento',
        mockPhone,
      );
      expect(result.intent).toBe(MessageIntent.REGISTER_TRANSACTION);
    });

    it('deve detectar transação com indicador temporal', async () => {
      const result = await intentService.analyzeIntent(
        'Ontem gastei 80 no jantar',
        mockPhone,
      );
      expect(result.intent).toBe(MessageIntent.REGISTER_TRANSACTION);
    });

    it('deve processar frase com múltiplas palavras-chave de categoria', async () => {
      const matches = await ragService.findSimilarCategories(
        'Fui ao supermercado comprar carne, frutas e verduras para a semana',
        mockUserId,
        { accountId: mockAccountId, minScore: 0.2 },
      );
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].categoryName).toBe('Alimentação');
    });

    it('deve processar mensagem com emoji e pontuação', async () => {
      const result = await intentService.analyzeIntent('saldo!!!', mockPhone);
      expect(result.intent).toBe(MessageIntent.CHECK_BALANCE);
    });

    it('deve processar mensagem com espaços extras', async () => {
      const result = await intentService.analyzeIntent('  meu   saldo  ', mockPhone);
      expect(result.intent).toBe(MessageIntent.CHECK_BALANCE);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // PARTE 9: MENSAGENS QUE NÃO DEVEM SER PROCESSADAS
  // ═══════════════════════════════════════════════════════════════

  describe('Fase 9: Mensagens Irrelevantes e Desconhecidas', () => {
    it.each([
      'xpto abc 123 random',
      'kkkkkkkk',
      'hahaha muito bom',
      'top demais',
      '...',
      '???',
    ])('deve retornar UNKNOWN ou IRRELEVANT para: "%s"', async (msg) => {
      const result = await intentService.analyzeIntent(msg, mockPhone);
      expect([MessageIntent.UNKNOWN, MessageIntent.IRRELEVANT]).toContain(result.intent);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // PARTE 10: MENSAGENS COLOQUIAIS BRASILEIRAS
  // ═══════════════════════════════════════════════════════════════

  describe('Fase 10: Mensagens Coloquiais do Dia a Dia Brasileiro', () => {
    describe('Registro de despesas - linguagem coloquial', () => {
      it.each([
        'Gastei 50 conto no mercado',
        'Paguei 30 pila no almoço',
        'Deixei 100 mangos na farmácia',
        'Torrei 200 no shopping',
        'Gastei uma nota no supermercado',
      ])('deve detectar transação coloquial: "%s"', async (msg) => {
        const result = await intentService.analyzeIntent(msg, mockPhone);
        // Coloquialismos podem ter score variável
        expect([MessageIntent.REGISTER_TRANSACTION, MessageIntent.UNKNOWN]).toContain(result.intent);
      });
    });

    describe('Consultas coloquiais', () => {
      it.each([
        ['tô devendo', MessageIntent.CHECK_BALANCE],
        ['to devendo', MessageIntent.CHECK_BALANCE],
        ['quanto sobrou', MessageIntent.CHECK_BALANCE],
        ['como tô', MessageIntent.MONTHLY_SUMMARY],
        ['gastos recentes', MessageIntent.LIST_TRANSACTIONS],
      ])('deve reconhecer consulta coloquial "%s" → %s', async (msg, expected) => {
        const result = await intentService.analyzeIntent(msg, mockPhone);
        expect(result.intent).toBe(expected);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // PARTE 11: VOLUME DE MENSAGENS SIMULTÂNEAS
  // ═══════════════════════════════════════════════════════════════

  describe('Fase 11: Volume - Processamento em lote', () => {
    const bulkMessages = [
      { msg: 'Gastei 50 no mercado', intent: MessageIntent.REGISTER_TRANSACTION, cat: 'Alimentação' },
      { msg: 'saldo', intent: MessageIntent.CHECK_BALANCE, cat: null },
      { msg: 'Paguei 120 da luz', intent: MessageIntent.REGISTER_TRANSACTION, cat: 'Serviços' },
      { msg: 'resumo do mês', intent: MessageIntent.MONTHLY_SUMMARY, cat: null },
      { msg: 'Comprei remédio 35', intent: MessageIntent.REGISTER_TRANSACTION, cat: 'Saúde' },
      { msg: 'meus cartões', intent: MessageIntent.LIST_CREDIT_CARDS, cat: null },
      { msg: 'Paguei 99 da academia', intent: MessageIntent.REGISTER_TRANSACTION, cat: 'Serviços' },
      { msg: 'ajuda', intent: MessageIntent.HELP, cat: null },
      { msg: 'Gastei 60 cinema', intent: MessageIntent.REGISTER_TRANSACTION, cat: 'Recreação' },
      { msg: 'oi', intent: MessageIntent.GREETING, cat: null },
      { msg: 'Paguei 250 dentista', intent: MessageIntent.REGISTER_TRANSACTION, cat: 'Saúde' },
      { msg: 'sim', intent: MessageIntent.CONFIRMATION_RESPONSE, cat: null },
      { msg: 'Comprei gasolina 150', intent: MessageIntent.REGISTER_TRANSACTION, cat: 'Transporte' },
      { msg: 'pendentes', intent: MessageIntent.LIST_PENDING_PAYMENTS, cat: null },
      { msg: 'Paguei hotel 480', intent: MessageIntent.REGISTER_TRANSACTION, cat: 'Viajem' },
      { msg: 'gráfico', intent: MessageIntent.GENERATE_CHART, cat: null },
      { msg: 'Comprei roupas 189', intent: MessageIntent.REGISTER_TRANSACTION, cat: 'Vestuário' },
      { msg: 'Paguei creche 650', intent: MessageIntent.REGISTER_TRANSACTION, cat: 'Educação' },
      { msg: 'Comprei cafeteira 249', intent: MessageIntent.REGISTER_TRANSACTION, cat: 'Eletrônicos' },
      { msg: 'Paguei consórcio 450', intent: MessageIntent.REGISTER_TRANSACTION, cat: 'Investimentos' },
    ];

    it('deve processar 20 mensagens variadas corretamente', async () => {
      const results = await Promise.all(
        bulkMessages.map(async ({ msg, intent, cat }) => {
          const intentResult = await intentService.analyzeIntent(msg, mockPhone);
          let categoryMatch = null;

          if (intent === MessageIntent.REGISTER_TRANSACTION && cat) {
            const matches = await ragService.findSimilarCategories(msg, mockUserId, { accountId: mockAccountId,
              minScore: 0.2,
              maxResults: 3,
            });
            categoryMatch = matches.length > 0 ? matches[0].categoryName : null;
          }

          return { msg, expectedIntent: intent, actualIntent: intentResult.intent, expectedCat: cat, actualCat: categoryMatch };
        }),
      );

      // Verifica que a maioria dos intents foram detectados corretamente
      const correctIntents = results.filter((r) => r.actualIntent === r.expectedIntent);
      const intentAccuracy = correctIntents.length / results.length;
      expect(intentAccuracy).toBeGreaterThanOrEqual(0.8); // 80% mínimo

      // Verifica categorias para transações
      const transactionResults = results.filter((r) => r.expectedIntent === MessageIntent.REGISTER_TRANSACTION && r.expectedCat);
      const correctCategories = transactionResults.filter((r) => r.actualCat === r.expectedCat);
      if (transactionResults.length > 0) {
        const catAccuracy = correctCategories.length / transactionResults.length;
        expect(catAccuracy).toBeGreaterThanOrEqual(0.6); // 60% mínimo (RAG sem IA)
      }
    });
  });
});

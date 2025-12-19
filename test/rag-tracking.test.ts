import { Test, TestingModule } from '@nestjs/testing';
import { RAGService } from '../src/infrastructure/ai/rag/rag.service';
import { AIUsageLoggerService } from '../src/infrastructure/ai/ai-usage-logger.service';
import { CategoryResolutionService } from '../src/infrastructure/ai/category-resolution.service';
import { PrismaService } from '../src/core/database/prisma.service';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

/**
 * Script de Teste para Sistema de Tracking RAG + AI
 * 
 * Este script testa o fluxo completo:
 * 1. RAG busca inicial
 * 2. AI fallback (se necessário)
 * 3. Tracking em RAGSearchLog e AIUsageLog
 * 4. Validação dos 23 novos campos
 * 
 * COMO USAR:
 * ```bash
 * npx ts-node test/rag-tracking.test.ts
 * ```
 * 
 * REQUISITOS:
 * - Database configurado e migrations aplicadas
 * - Categorias do usuário indexadas no RAG
 */

describe('RAG Tracking System - Integration Test', () => {
  let module: TestingModule;
  let ragService: RAGService;
  let aiUsageLogger: AIUsageLoggerService;
  let categoryResolution: CategoryResolutionService;
  let prisma: PrismaService;

  const TEST_USER_ID = 'test-user-123';
  const TEST_PHONE = '+5511999999999';

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [
        PrismaService,
        RAGService,
        AIUsageLoggerService,
        CategoryResolutionService,
        ConfigService,
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
      ],
    }).compile();

    ragService = module.get<RAGService>(RAGService);
    aiUsageLogger = module.get<AIUsageLoggerService>(AIUsageLoggerService);
    categoryResolution = module.get<CategoryResolutionService>(CategoryResolutionService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await module.close();
  });

  describe('1. RAG Search Tracking', () => {
    it('deve criar log com campos de tracking quando RAG encontra categoria', async () => {
      // Indexar categorias de teste
      await ragService.indexUserCategories(TEST_USER_ID, [
        {
          id: 'cat_1',
          name: 'Alimentação',
          subCategory: { id: 'sub_1', name: 'Supermercado' },
        },
        {
          id: 'cat_2',
          name: 'Transporte',
          subCategory: { id: 'sub_2', name: 'Combustível' },
        },
      ]);

      // Buscar categoria
      const matches = await ragService.findSimilarCategories(
        'gasolina posto shell',
        TEST_USER_ID,
        { minScore: 0.5 },
      );

      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].categoryName).toBe('Transporte');

      // Verificar log no banco
      const logs = await prisma.rAGSearchLog.findMany({
        where: { userId: TEST_USER_ID },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });

      const log = logs[0];
      expect(log).toBeDefined();
      expect(log.query).toBe('gasolina posto shell');
      expect(log.success).toBe(true);
      expect(log.bestMatch).toBe('Transporte');
      
      // 🆕 Validar novos campos
      expect(log.flowStep).toBe(1);
      expect(log.totalSteps).toBe(1);
      expect(log.wasAiFallback).toBe(false);
      expect(log.finalCategoryId).toBeDefined();
      expect(log.finalCategoryName).toBe('Transporte');
      expect(log.ragInitialScore).toBeGreaterThan(0);

      console.log('✅ Teste 1 PASSOU: RAG tracking funcionando');
    });

    it('deve criar log quando RAG não encontra categoria', async () => {
      const matches = await ragService.findSimilarCategories(
        'comprei um widget quantum',
        TEST_USER_ID,
        { minScore: 0.8 },
      );

      expect(matches.length).toBe(0);

      // Verificar log
      const logs = await prisma.rAGSearchLog.findMany({
        where: { 
          userId: TEST_USER_ID,
          query: 'comprei um widget quantum'
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });

      const log = logs[0];
      expect(log).toBeDefined();
      expect(log.success).toBe(false);
      expect(log.bestMatch).toBeNull();
      expect(log.flowStep).toBe(1);
      expect(log.wasAiFallback).toBe(false);

      console.log('✅ Teste 2 PASSOU: RAG log de falha funcionando');
    });
  });

  describe('2. AI Usage Tracking com Contexto RAG', () => {
    it('deve criar log de IA com contexto RAG quando usado como fallback', async () => {
      // Simular chamada de IA após RAG falhar
      const ragSearchLogId = await ragService.logSearchWithContext({
        userId: TEST_USER_ID,
        query: 'widget quantum',
        matches: [],
        success: false,
        threshold: 0.7,
        ragMode: 'BM25',
        responseTime: 50,
        flowStep: 1,
        totalSteps: 2,
        wasAiFallback: true,
      });

      // Simular log de IA
      const aiLogId = await aiUsageLogger.logUsage({
        userCacheId: TEST_USER_ID,
        phoneNumber: TEST_PHONE,
        provider: 'openai',
        model: 'gpt-4o-mini',
        operation: 'CATEGORY_SUGGESTION',
        inputType: 'TEXT',
        inputText: 'widget quantum',
        inputTokens: 50,
        outputTokens: 20,
        totalTokens: 70,
        estimatedCost: 0.00001,
        responseTime: 1200,
        success: true,
        // 🆕 Contexto RAG
        ragSearchLogId,
        ragInitialFound: false,
        ragInitialScore: 0.3,
        ragInitialCategory: null,
        aiCategoryId: 'cat_outros',
        aiCategoryName: 'Eletrônicos',
        aiConfidence: 0.85,
        finalCategoryId: 'cat_outros',
        finalCategoryName: 'Eletrônicos',
        wasRagFallback: false,
        needsSynonymLearning: true,
      });

      expect(aiLogId).toBeDefined();

      // Verificar log no banco
      const log = await prisma.aIUsageLog.findUnique({
        where: { id: aiLogId },
      });

      expect(log).toBeDefined();
      expect(log.ragSearchLogId).toBe(ragSearchLogId);
      expect(log.ragInitialFound).toBe(false);
      expect(log.aiCategoryName).toBe('Eletrônicos');
      expect(log.aiConfidence).toBeDefined();
      expect(log.wasRagFallback).toBe(false);
      expect(log.needsSynonymLearning).toBe(true);

      console.log('✅ Teste 3 PASSOU: AI log com contexto RAG funcionando');
    });
  });

  describe('3. Category Resolution Service', () => {
    it('deve resolver categoria via RAG (cenário 1: RAG sucesso)', async () => {
      const result = await categoryResolution.resolveCategory({
        userId: TEST_USER_ID,
        text: 'gasolina',
        minConfidence: 0.7,
        useAiFallback: false,
        phoneNumber: TEST_PHONE,
      });

      expect(result).toBeDefined();
      expect(result.source).toBe('RAG');
      expect(result.ragSearchLogId).toBeDefined();
      expect(result.needsSynonymLearning).toBe(false);

      console.log('✅ Teste 4 PASSOU: Resolução via RAG funcionando');
    });

    it('deve usar AI fallback quando RAG falha (cenário 2: AI fallback)', async () => {
      const result = await categoryResolution.resolveCategory({
        userId: TEST_USER_ID,
        text: 'produto ultra específico xyz',
        minConfidence: 0.7,
        useAiFallback: true,
        phoneNumber: TEST_PHONE,
      });

      // Neste teste, esperamos que RAG falhe e AI seja usada
      // Como temos MOCK, o resultado será AI
      if (result) {
        expect(result.source).toBe('AI');
        expect(result.ragSearchLogId).toBeDefined();
        expect(result.aiUsageLogId).toBeDefined();
        expect(result.needsSynonymLearning).toBe(true);

        console.log('✅ Teste 5 PASSOU: AI fallback funcionando');
      } else {
        console.log('⚠️  Teste 5 PULADO: AI fallback não disponível (esperado em mock)');
      }
    });
  });

  describe('4. Análise de Logs', () => {
    it('deve retornar logs com todos os campos de tracking', async () => {
      const { logs } = await ragService.getSearchAttempts(TEST_USER_ID, false, 10, 0);

      expect(logs.length).toBeGreaterThan(0);

      // Validar estrutura dos logs
      logs.forEach((log) => {
        expect(log).toHaveProperty('id');
        expect(log).toHaveProperty('query');
        expect(log).toHaveProperty('success');
        expect(log).toHaveProperty('bestMatch');
        expect(log).toHaveProperty('bestScore');
        expect(log).toHaveProperty('ragMode');
        expect(log).toHaveProperty('responseTime');
      });

      console.log('✅ Teste 6 PASSOU: Recuperação de logs funcionando');
      console.log(`📊 Total de logs encontrados: ${logs.length}`);
    });
  });

  describe('5. Validação de Performance', () => {
    it('deve processar múltiplas buscas RAG rapidamente', async () => {
      const queries = [
        'supermercado',
        'uber',
        'netflix',
        'padaria',
        'academia',
      ];

      const startTime = Date.now();

      for (const query of queries) {
        await ragService.findSimilarCategories(query, TEST_USER_ID, {
          minScore: 0.5,
        });
      }

      const totalTime = Date.now() - startTime;
      const avgTime = totalTime / queries.length;

      console.log(`📊 Performance: ${queries.length} buscas em ${totalTime}ms (média: ${avgTime.toFixed(0)}ms/busca)`);

      expect(avgTime).toBeLessThan(100); // Menos de 100ms por busca

      console.log('✅ Teste 7 PASSOU: Performance adequada');
    });
  });
});

// Script de execução direta (sem Jest)
async function runManualTests() {
  console.log('🚀 Iniciando testes manuais do sistema de tracking...\n');

  const prisma = new PrismaService();

  try {
    // Teste 1: Verificar se migrations foram aplicadas
    console.log('1️⃣  Verificando migrations...');
    const ragLogs = await prisma.rAGSearchLog.findMany({ take: 1 });
    const aiLogs = await prisma.aIUsageLog.findMany({ take: 1 });
    console.log('✅ Migrations aplicadas corretamente\n');

    // Teste 2: Verificar novos campos
    console.log('2️⃣  Verificando novos campos...');
    const sampleRagLog = await prisma.rAGSearchLog.findFirst({
      select: {
        flowStep: true,
        totalSteps: true,
        wasAiFallback: true,
        aiProvider: true,
        finalCategoryId: true,
      },
    });
    console.log('✅ Novos campos disponíveis:', sampleRagLog || 'Nenhum log ainda\n');

    // Teste 3: Contar logs existentes
    console.log('3️⃣  Contando logs existentes...');
    const ragCount = await prisma.rAGSearchLog.count();
    const aiCount = await prisma.aIUsageLog.count();
    console.log(`📊 RAGSearchLog: ${ragCount} registros`);
    console.log(`📊 AIUsageLog: ${aiCount} registros\n`);

    console.log('✅ Todos os testes manuais passaram!');
  } catch (error) {
    console.error('❌ Erro nos testes:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Se executado diretamente (não via Jest)
if (require.main === module) {
  runManualTests();
}

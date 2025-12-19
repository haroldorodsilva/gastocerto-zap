/**
 * 📊 Exemplo de Implementação do Rastreamento RAG → IA → RAG
 * 
 * Este arquivo mostra como atualizar os services para popular os novos campos
 * de tracking em RAGSearchLog e AIUsageLog.
 * 
 * NÃO É PARA SER USADO DIRETAMENTE - É UM GUIA DE REFERÊNCIA
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/core/database/prisma.service';

// ============================================================================
// EXEMPLO 1: RAG Service - Busca com Tracking
// ============================================================================

interface RAGSearchResult {
  found: boolean;
  categoryId?: string;
  categoryName?: string;
  score: number;
  matches: any[];
  logId?: string; // ID do log criado
}

@Injectable()
export class RAGServiceExample {
  constructor(private prisma: PrismaService) {}

  /**
   * Busca categoria usando RAG com tracking completo
   * Step 1 do fluxo: RAG inicial
   */
  async searchCategory(
    query: string,
    userId: string,
    threshold: number = 0.6,
  ): Promise<RAGSearchResult> {
    const startTime = Date.now();

    // 1. Executar busca BM25 ou AI embeddings
    const matches = await this.executeBM25Search(query);
    const bestMatch = matches[0];
    const bestScore = bestMatch?.score || 0;
    const success = bestScore >= threshold;

    // 2. Criar log do step 1 (RAG inicial)
    const logId = await this.createRAGLog({
      userId,
      query,
      matches,
      bestMatch,
      bestScore,
      threshold,
      success,
      flowStep: 1,
      totalSteps: success ? 1 : 2, // Se falhou, vai precisar de IA (step 2)
      ragInitialScore: bestScore,
      wasAiFallback: !success,
      responseTime: Date.now() - startTime,
    });

    return {
      found: success,
      categoryId: bestMatch?.categoryId,
      categoryName: bestMatch?.categoryName,
      score: bestScore,
      matches,
      logId,
    };
  }

  /**
   * Criar log de busca RAG
   */
  private async createRAGLog(data: {
    userId: string;
    query: string;
    matches: any[];
    bestMatch: any;
    bestScore: number;
    threshold: number;
    success: boolean;
    flowStep: number;
    totalSteps: number;
    ragInitialScore?: number;
    ragFinalScore?: number;
    wasAiFallback: boolean;
    responseTime: number;
    aiProvider?: string;
    aiCategoryId?: string;
    aiCategoryName?: string;
    finalCategoryId?: string;
    finalCategoryName?: string;
  }): Promise<string> {
    const log = await this.prisma.rAGSearchLog.create({
      data: {
        userId: data.userId,
        query: data.query,
        queryNormalized: this.normalizeQuery(data.query),
        matches: data.matches,
        bestMatch: data.bestMatch?.categoryName,
        bestScore: data.bestScore,
        threshold: data.threshold,
        success: data.success,
        ragMode: 'BM25', // ou 'AI' se usar embeddings
        responseTime: data.responseTime,

        // 🆕 Campos de tracking
        flowStep: data.flowStep,
        totalSteps: data.totalSteps,
        ragInitialScore: data.ragInitialScore,
        ragFinalScore: data.ragFinalScore,
        wasAiFallback: data.wasAiFallback,
        aiProvider: data.aiProvider,
        aiCategoryId: data.aiCategoryId,
        aiCategoryName: data.aiCategoryName,
        finalCategoryId: data.finalCategoryId,
        finalCategoryName: data.finalCategoryName,
      },
    });

    return log.id;
  }

  private normalizeQuery(query: string): string {
    return query
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  private async executeBM25Search(query: string): Promise<any[]> {
    // Implementação real da busca BM25
    return [];
  }
}

// ============================================================================
// EXEMPLO 2: AI Service - Sugestão com Contexto RAG
// ============================================================================

interface AICategoryResult {
  categoryId: string;
  categoryName: string;
  subCategoryId?: string;
  subCategoryName?: string;
  confidence: number;
  needsSynonymLearning: boolean;
}

@Injectable()
export class AIServiceExample {
  constructor(private prisma: PrismaService) {}

  /**
   * Sugere categoria usando IA quando RAG falhou
   * Step 2 do fluxo: IA Fallback
   */
  async suggestCategoryWithRAGContext(
    query: string,
    userId: string,
    ragResult: RAGSearchResult, // Resultado do step 1
  ): Promise<AICategoryResult> {
    const startTime = Date.now();

    // 1. Chamar IA para sugerir categoria
    const aiResponse = await this.callAI(query);

    // 2. Decidir se vale criar sinônimo
    const needsSynonymLearning =
      aiResponse.confidence >= 0.8 && // IA teve alta confiança
      ragResult.score < 0.6; // RAG não achou nada bom

    // 3. Criar log com contexto RAG
    await this.createAILog({
      userId,
      query,
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      operation: 'CATEGORY_SUGGESTION',
      inputTokens: aiResponse.inputTokens,
      outputTokens: aiResponse.outputTokens,
      totalTokens: aiResponse.totalTokens,
      estimatedCost: aiResponse.cost,
      responseTime: Date.now() - startTime,

      // 🆕 Contexto RAG
      ragSearchLogId: ragResult.logId, // Vincula com log do step 1
      ragInitialFound: ragResult.matches.length > 0,
      ragInitialScore: ragResult.score,
      ragInitialCategory: ragResult.categoryName,
      aiCategoryId: aiResponse.categoryId,
      aiCategoryName: aiResponse.categoryName,
      aiConfidence: aiResponse.confidence,
      finalCategoryId: aiResponse.categoryId, // Por enquanto, usar IA como final
      finalCategoryName: aiResponse.categoryName,
      wasRagFallback: true,
      needsSynonymLearning,
    });

    return {
      categoryId: aiResponse.categoryId,
      categoryName: aiResponse.categoryName,
      subCategoryId: aiResponse.subCategoryId,
      subCategoryName: aiResponse.subCategoryName,
      confidence: aiResponse.confidence,
      needsSynonymLearning,
    };
  }

  /**
   * Criar log de uso de IA
   */
  private async createAILog(data: {
    userId: string;
    query: string;
    provider: string;
    model: string;
    operation: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCost: number;
    responseTime: number;
    ragSearchLogId?: string;
    ragInitialFound?: boolean;
    ragInitialScore?: number;
    ragInitialCategory?: string;
    aiCategoryId?: string;
    aiCategoryName?: string;
    aiConfidence?: number;
    finalCategoryId?: string;
    finalCategoryName?: string;
    wasRagFallback: boolean;
    needsSynonymLearning: boolean;
  }): Promise<void> {
    await this.prisma.aIUsageLog.create({
      data: {
        userCacheId: userId,
        phoneNumber: await this.getUserPhone(userId),
        provider: data.provider,
        model: data.model,
        operation: data.operation as any,
        inputType: 'TEXT',
        inputText: data.query,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        totalTokens: data.totalTokens,
        estimatedCost: data.estimatedCost,
        responseTime: data.responseTime,
        success: true,

        // 🆕 Contexto RAG
        ragSearchLogId: data.ragSearchLogId,
        ragInitialFound: data.ragInitialFound,
        ragInitialScore: data.ragInitialScore,
        ragInitialCategory: data.ragInitialCategory,
        aiCategoryId: data.aiCategoryId,
        aiCategoryName: data.aiCategoryName,
        aiConfidence: data.aiConfidence,
        finalCategoryId: data.finalCategoryId,
        finalCategoryName: data.finalCategoryName,
        wasRagFallback: data.wasRagFallback,
        needsSynonymLearning: data.needsSynonymLearning,
      },
    });
  }

  private async callAI(query: string): Promise<any> {
    // Implementação real da chamada de IA
    return {
      categoryId: '123',
      categoryName: 'Receitas → Salário',
      confidence: 0.95,
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      cost: 0.0001,
    };
  }

  private async getUserPhone(userId: string): Promise<string> {
    const user = await this.prisma.userCache.findUnique({
      where: { gastoCertoId: userId },
      select: { phoneNumber: true },
    });
    return user?.phoneNumber || 'unknown';
  }
}

// ============================================================================
// EXEMPLO 3: Fluxo Completo - RAG → IA → Validação (Opcional)
// ============================================================================

@Injectable()
export class CategoryResolutionService {
  constructor(
    private ragService: RAGServiceExample,
    private aiService: AIServiceExample,
    private prisma: PrismaService,
  ) {}

  /**
   * Resolve categoria com tracking completo
   * Fluxo: RAG (step 1) → IA se falhar (step 2) → RAG validação (step 3, opcional)
   */
  async resolveCategory(
    query: string,
    userId: string,
  ): Promise<{
    categoryId: string;
    categoryName: string;
    source: 'RAG' | 'AI';
    confidence: number;
  }> {
    // STEP 1: Tentar RAG primeiro
    const ragResult = await this.ragService.searchCategory(query, userId);

    if (ragResult.found) {
      // ✅ RAG acertou de primeira
      return {
        categoryId: ragResult.categoryId!,
        categoryName: ragResult.categoryName!,
        source: 'RAG',
        confidence: ragResult.score,
      };
    }

    // STEP 2: RAG falhou, fallback para IA
    const aiResult = await this.aiService.suggestCategoryWithRAGContext(
      query,
      userId,
      ragResult,
    );

    // STEP 3: (OPCIONAL) Validar resultado da IA no RAG
    // Útil para ver se com mais contexto o RAG reconheceria
    if (aiResult.confidence >= 0.8) {
      await this.validateWithRAG(query, userId, aiResult, ragResult.logId!);
    }

    return {
      categoryId: aiResult.categoryId,
      categoryName: aiResult.categoryName,
      source: 'AI',
      confidence: aiResult.confidence,
    };
  }

  /**
   * Step 3: Validação final com RAG (opcional)
   * Útil para análise: ver se depois da IA sugerir, RAG reconheceria
   */
  private async validateWithRAG(
    query: string,
    userId: string,
    aiResult: AICategoryResult,
    initialRagLogId: string,
  ): Promise<void> {
    const startTime = Date.now();

    // Tentar buscar novamente com o termo que IA retornou
    const matches = await this.ragService['executeBM25Search'](
      aiResult.categoryName,
    );
    const bestScore = matches[0]?.score || 0;

    // Criar log do step 3 (validação)
    await this.prisma.rAGSearchLog.create({
      data: {
        userId,
        query,
        queryNormalized: query.toLowerCase(),
        matches: matches,
        bestMatch: matches[0]?.categoryName,
        bestScore: bestScore,
        threshold: 0.6,
        success: bestScore >= 0.6,
        ragMode: 'BM25',
        responseTime: Date.now() - startTime,

        // 🆕 Tracking do step 3
        flowStep: 3,
        totalSteps: 3,
        ragFinalScore: bestScore,
        aiProvider: 'groq',
        aiCategoryId: aiResult.categoryId,
        aiCategoryName: aiResult.categoryName,
        finalCategoryId: aiResult.categoryId,
        finalCategoryName: aiResult.categoryName,
        wasAiFallback: true,
      },
    });
  }
}

// ============================================================================
// EXEMPLO 4: Queries de Análise
// ============================================================================

@Injectable()
export class RAGAnalyticsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Buscar keywords que precisam de sinônimos
   * Casos onde RAG falhou mas IA acertou com alta confiança
   */
  async findMissingSynonyms(days: number = 30): Promise<
    Array<{
      query: string;
      ragScore: number;
      aiCategory: string;
      aiConfidence: number;
      occurrences: number;
    }>
  > {
    const result = await this.prisma.$queryRaw<any[]>`
      SELECT 
        ai.inputText as query,
        ROUND(AVG(ai.ragInitialScore)::numeric, 4) as ragScore,
        ai.aiCategoryName as aiCategory,
        ROUND(AVG(ai.aiConfidence)::numeric, 4) as aiConfidence,
        COUNT(*) as occurrences
      FROM ai_usage_logs ai
      WHERE 
        ai.wasRagFallback = true
        AND ai.success = true
        AND ai.needsSynonymLearning = true
        AND ai.createdAt >= NOW() - INTERVAL '${days} days'
      GROUP BY ai.inputText, ai.aiCategoryName
      HAVING COUNT(*) >= 2
      ORDER BY occurrences DESC, aiConfidence DESC
      LIMIT 50
    `;

    return result.map((r) => ({
      query: r.query,
      ragScore: parseFloat(r.ragscore),
      aiCategory: r.aicategory,
      aiConfidence: parseFloat(r.aiconfidence),
      occurrences: parseInt(r.occurrences),
    }));
  }

  /**
   * Taxa de fallback por usuário
   */
  async getFallbackRateByUser(): Promise<
    Array<{
      userName: string;
      totalQueries: number;
      fallbacks: number;
      fallbackRate: number;
    }>
  > {
    const result = await this.prisma.$queryRaw<any[]>`
      SELECT 
        uc.name as userName,
        COUNT(*) as totalQueries,
        SUM(CASE WHEN ai.wasRagFallback = true THEN 1 ELSE 0 END) as fallbacks,
        ROUND(
          (SUM(CASE WHEN ai.wasRagFallback = true THEN 1 ELSE 0 END)::numeric / COUNT(*)) * 100, 
          2
        ) as fallbackRate
      FROM ai_usage_logs ai
      JOIN user_cache uc ON uc.gastoCertoId = ai.userCacheId
      WHERE 
        ai.operation = 'CATEGORY_SUGGESTION'
        AND ai.createdAt >= NOW() - INTERVAL '30 days'
      GROUP BY uc.name
      HAVING COUNT(*) >= 10
      ORDER BY fallbackRate DESC
      LIMIT 20
    `;

    return result.map((r) => ({
      userName: r.username,
      totalQueries: parseInt(r.totalqueries),
      fallbacks: parseInt(r.fallbacks),
      fallbackRate: parseFloat(r.fallbackrate),
    }));
  }

  /**
   * Performance do RAG ao longo do tempo
   */
  async getRAGPerformanceOverTime(): Promise<
    Array<{
      week: Date;
      totalSearches: number;
      successes: number;
      fallbacks: number;
      successRate: number;
    }>
  > {
    const result = await this.prisma.$queryRaw<any[]>`
      SELECT 
        DATE_TRUNC('week', rag.createdAt) as week,
        COUNT(*) as totalSearches,
        SUM(CASE WHEN rag.success = true THEN 1 ELSE 0 END) as successes,
        SUM(CASE WHEN rag.wasAiFallback = true THEN 1 ELSE 0 END) as fallbacks,
        ROUND(
          (SUM(CASE WHEN rag.success = true THEN 1 ELSE 0 END)::numeric / COUNT(*)) * 100, 
          2
        ) as successRate
      FROM rag_search_logs rag
      WHERE 
        rag.flowStep = 1
        AND rag.createdAt >= NOW() - INTERVAL '90 days'
      GROUP BY DATE_TRUNC('week', rag.createdAt)
      ORDER BY week DESC
    `;

    return result.map((r) => ({
      week: new Date(r.week),
      totalSearches: parseInt(r.totalsearches),
      successes: parseInt(r.successes),
      fallbacks: parseInt(r.fallbacks),
      successRate: parseFloat(r.successrate),
    }));
  }
}

/**
 * NOTAS DE IMPLEMENTAÇÃO:
 * 
 * 1. Integração nos services existentes:
 *    - src/infrastructure/ai/services/rag.service.ts
 *    - src/infrastructure/ai/services/ai.service.ts
 * 
 * 2. Adicionar campos de tracking em todas chamadas RAG e IA
 * 
 * 3. Criar job (cron) para executar findMissingSynonyms() diariamente
 *    e criar sinônimos automaticamente em user_synonyms
 * 
 * 4. Criar endpoints admin para visualizar analytics:
 *    GET /admin/rag/analytics
 *    GET /admin/rag/missing-synonyms
 *    GET /admin/rag/performance
 * 
 * 5. Dashboard: Usar dados do RAGAnalyticsService para criar gráficos
 */

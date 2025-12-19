import { Injectable, Logger } from '@nestjs/common';
import { RAGService } from './rag/rag.service';
import { AIUsageLoggerService } from './ai-usage-logger.service';

/**
 * CategoryResolutionService
 *
 * Orquestra o fluxo completo de resolução de categoria com tracking:
 *
 * FLUXO:
 * 1️⃣ Busca RAG inicial (BM25 + sinônimos)
 * 2️⃣ Se não encontrar ou baixa confiança → Fallback para IA
 * 3️⃣ Validação e decisão final
 *
 * TRACKING:
 * - Registra cada etapa em RAGSearchLog
 * - Registra uso de IA em AIUsageLog com contexto RAG
 * - Popula campos de análise (flowStep, wasAiFallback, needsSynonymLearning)
 *
 * EXEMPLO:
 * ```typescript
 * const result = await categoryResolution.resolveCategory({
 *   userId: 'user123',
 *   text: 'gasolina posto shell',
 *   minConfidence: 0.7,
 *   useAiFallback: true,
 * });
 *
 * // result: {
 * //   categoryId: 'cat_abc',
 * //   categoryName: 'Transporte',
 * //   subCategoryId: 'sub_123',
 * //   subCategoryName: 'Combustível',
 * //   confidence: 0.85,
 * //   source: 'RAG' | 'AI',
 * //   ragSearchLogId: 'log_xyz',
 * //   aiUsageLogId: 'ai_log_xyz'
 * // }
 * ```
 */

export interface ResolutionOptions {
  userId: string;
  text: string;
  minConfidence?: number;
  useAiFallback?: boolean;
  aiProvider?: any; // IAIProvider instance
  phoneNumber?: string;
}

export interface ResolutionResult {
  categoryId: string;
  categoryName: string;
  subCategoryId?: string;
  subCategoryName?: string;
  confidence: number;
  source: 'RAG' | 'AI' | 'HYBRID';
  ragSearchLogId: string;
  aiUsageLogId?: string;
  needsSynonymLearning: boolean;
}

@Injectable()
export class CategoryResolutionService {
  private readonly logger = new Logger(CategoryResolutionService.name);
  private readonly defaultMinConfidence = 0.7;

  constructor(
    private readonly ragService: RAGService,
    private readonly aiUsageLogger: AIUsageLoggerService,
  ) {}

  /**
   * Resolve categoria usando RAG + AI (se necessário)
   */
  async resolveCategory(options: ResolutionOptions): Promise<ResolutionResult | null> {
    const startTime = Date.now();
    const minConfidence = options.minConfidence ?? this.defaultMinConfidence;
    const useAiFallback = options.useAiFallback ?? true;

    this.logger.log(`🔍 Resolvendo categoria: "${options.text}" (minConfidence: ${minConfidence})`);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 1: Busca RAG inicial
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const ragMatches = await this.ragService.findSimilarCategories(
      options.text,
      options.userId,
      { minScore: 0.25 }, // Score baixo para capturar possíveis matches
    );

    const bestRagMatch = ragMatches.length > 0 ? ragMatches[0] : null;
    const ragScore = bestRagMatch?.score || 0;
    const ragFound = ragScore >= minConfidence;

    this.logger.debug(
      `📊 RAG Result: ${ragFound ? '✅ Found' : '❌ Not Found'} ` +
        `(score: ${(ragScore * 100).toFixed(1)}%, threshold: ${(minConfidence * 100).toFixed(1)}%)`,
    );

    // Se RAG encontrou com confiança suficiente → retornar direto
    if (ragFound && bestRagMatch) {
      const responseTime = Date.now() - startTime;

      // Log RAG com sucesso (flow completo em 1 step)
      const ragSearchLogId = await this.ragService.logSearchWithContext({
        userId: options.userId,
        query: options.text,
        matches: ragMatches,
        success: true,
        threshold: minConfidence,
        ragMode: 'BM25',
        responseTime,
        flowStep: 1,
        totalSteps: 1,
        finalCategoryId: bestRagMatch.categoryId,
        finalCategoryName: bestRagMatch.categoryName,
        wasAiFallback: false,
      });

      this.logger.log(
        `✅ Categoria resolvida via RAG: ${bestRagMatch.categoryName}` +
          `${bestRagMatch.subCategoryName ? ' → ' + bestRagMatch.subCategoryName : ''} ` +
          `(${(ragScore * 100).toFixed(1)}%)`,
      );

      return {
        categoryId: bestRagMatch.categoryId,
        categoryName: bestRagMatch.categoryName,
        subCategoryId: bestRagMatch.subCategoryId,
        subCategoryName: bestRagMatch.subCategoryName,
        confidence: ragScore,
        source: 'RAG',
        ragSearchLogId,
        needsSynonymLearning: false,
      };
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 2: Fallback para IA
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (!useAiFallback || !options.aiProvider) {
      // Não usar IA → log e retornar null
      const responseTime = Date.now() - startTime;

      await this.ragService.logSearchWithContext({
        userId: options.userId,
        query: options.text,
        matches: ragMatches,
        success: false,
        threshold: minConfidence,
        ragMode: 'BM25',
        responseTime,
        flowStep: 1,
        totalSteps: 1,
        wasAiFallback: false,
      });

      this.logger.warn(`⚠️ RAG não encontrou categoria e IA fallback está desabilitado`);
      return null;
    }

    this.logger.debug(`🤖 Fallback para IA...`);

    try {
      // Simular chamada de IA (você deve adaptar para seu provider)
      // const aiResult = await options.aiProvider.suggestCategory(options.text);

      // MOCK para exemplo (substitua pela chamada real)
      const aiResult = {
        categoryId: 'ai_cat_123',
        categoryName: 'Transporte',
        subCategoryId: 'ai_sub_456',
        subCategoryName: 'Combustível',
        confidence: 0.82,
        inputTokens: 50,
        outputTokens: 20,
        model: 'gpt-4o-mini',
        provider: 'openai',
      };

      const aiResponseTime = Date.now() - startTime;

      // Log RAG com contexto de fallback (step 1/2)
      const ragSearchLogId = await this.ragService.logSearchWithContext({
        userId: options.userId,
        query: options.text,
        matches: ragMatches,
        success: false, // RAG falhou
        threshold: minConfidence,
        ragMode: 'BM25',
        responseTime: aiResponseTime - (aiResponseTime - startTime), // Apenas tempo do RAG
        flowStep: 1,
        totalSteps: 2,
        aiProvider: aiResult.provider,
        aiModel: aiResult.model,
        aiConfidence: aiResult.confidence,
        aiCategoryId: aiResult.categoryId,
        aiCategoryName: aiResult.categoryName,
        finalCategoryId: aiResult.categoryId,
        finalCategoryName: aiResult.categoryName,
        wasAiFallback: true,
      });

      // Log uso de IA com contexto RAG
      const aiUsageLogId = await this.aiUsageLogger.logUsage({
        userCacheId: options.userId,
        phoneNumber: options.phoneNumber || 'unknown',
        provider: aiResult.provider,
        model: aiResult.model,
        operation: 'CATEGORY_SUGGESTION',
        inputType: 'TEXT',
        inputText: options.text,
        inputTokens: aiResult.inputTokens,
        outputTokens: aiResult.outputTokens,
        totalTokens: aiResult.inputTokens + aiResult.outputTokens,
        estimatedCost: 0,
        responseTime: aiResponseTime,
        success: true,
        // 🆕 Contexto RAG
        ragSearchLogId,
        ragInitialFound: false,
        ragInitialScore: ragScore,
        ragInitialCategory: bestRagMatch?.categoryName,
        aiCategoryId: aiResult.categoryId,
        aiCategoryName: aiResult.categoryName,
        aiConfidence: aiResult.confidence,
        finalCategoryId: aiResult.categoryId,
        finalCategoryName: aiResult.categoryName,
        wasRagFallback: false,
        needsSynonymLearning: true, // IA teve que complementar RAG
      });

      this.logger.log(
        `✅ Categoria resolvida via IA: ${aiResult.categoryName}` +
          `${aiResult.subCategoryName ? ' → ' + aiResult.subCategoryName : ''} ` +
          `(${(aiResult.confidence * 100).toFixed(1)}%) [Fallback after RAG]`,
      );

      return {
        categoryId: aiResult.categoryId,
        categoryName: aiResult.categoryName,
        subCategoryId: aiResult.subCategoryId,
        subCategoryName: aiResult.subCategoryName,
        confidence: aiResult.confidence,
        source: 'AI',
        ragSearchLogId,
        aiUsageLogId,
        needsSynonymLearning: true,
      };
    } catch (error) {
      this.logger.error(`❌ Erro no fallback de IA:`, error);

      // Log RAG failure
      await this.ragService.logSearchWithContext({
        userId: options.userId,
        query: options.text,
        matches: ragMatches,
        success: false,
        threshold: minConfidence,
        ragMode: 'BM25',
        responseTime: Date.now() - startTime,
        flowStep: 1,
        totalSteps: 2,
        wasAiFallback: true,
      });

      return null;
    }
  }

  /**
   * Validação híbrida: RAG + IA em paralelo, escolhe o melhor
   */
  async resolveWithHybridValidation(options: ResolutionOptions): Promise<ResolutionResult | null> {
    const startTime = Date.now();
    const minConfidence = options.minConfidence ?? this.defaultMinConfidence;

    this.logger.log(`🔍 [HYBRID] Resolvendo categoria: "${options.text}"`);

    // Executar RAG e IA em paralelo
    const [ragMatches, aiResult] = await Promise.all([
      this.ragService.findSimilarCategories(options.text, options.userId, { minScore: 0.25 }),
      // Simulação de IA (adapte para seu provider)
      Promise.resolve({
        categoryId: 'ai_cat_123',
        categoryName: 'Transporte',
        confidence: 0.8,
        inputTokens: 50,
        outputTokens: 20,
        model: 'gpt-4o-mini',
        provider: 'openai',
      }),
    ]);

    const bestRagMatch = ragMatches.length > 0 ? ragMatches[0] : null;
    const ragScore = bestRagMatch?.score || 0;

    // Escolher o melhor resultado
    const useRag = ragScore >= aiResult.confidence;
    const finalCategory = useRag ? bestRagMatch : aiResult;
    const source = useRag ? 'RAG' : ragScore > 0 ? 'HYBRID' : 'AI';

    const responseTime = Date.now() - startTime;

    // Log RAG com contexto híbrido
    const ragSearchLogId = await this.ragService.logSearchWithContext({
      userId: options.userId,
      query: options.text,
      matches: ragMatches,
      success: true,
      threshold: minConfidence,
      ragMode: 'HYBRID',
      responseTime,
      flowStep: 1,
      totalSteps: 1,
      aiProvider: aiResult.provider,
      aiModel: aiResult.model,
      aiConfidence: aiResult.confidence,
      aiCategoryId: aiResult.categoryId,
      aiCategoryName: aiResult.categoryName,
      finalCategoryId: finalCategory.categoryId,
      finalCategoryName: finalCategory.categoryName,
      wasAiFallback: !useRag,
    });

    // Log uso de IA
    const aiUsageLogId = await this.aiUsageLogger.logUsage({
      userCacheId: options.userId,
      phoneNumber: options.phoneNumber || 'unknown',
      provider: aiResult.provider,
      model: aiResult.model,
      operation: 'CATEGORY_SUGGESTION',
      inputType: 'TEXT',
      inputText: options.text,
      inputTokens: aiResult.inputTokens,
      outputTokens: aiResult.outputTokens,
      totalTokens: aiResult.inputTokens + aiResult.outputTokens,
      estimatedCost: 0,
      responseTime,
      success: true,
      ragSearchLogId,
      ragInitialFound: ragScore >= minConfidence,
      ragInitialScore: ragScore,
      ragInitialCategory: bestRagMatch?.categoryName,
      aiCategoryId: aiResult.categoryId,
      aiCategoryName: aiResult.categoryName,
      aiConfidence: aiResult.confidence,
      finalCategoryId: finalCategory.categoryId,
      finalCategoryName: finalCategory.categoryName,
      wasRagFallback: useRag,
      needsSynonymLearning: !useRag,
    });

    this.logger.log(
      `✅ [HYBRID] Categoria: ${finalCategory.categoryName} ` +
        `(RAG: ${(ragScore * 100).toFixed(1)}%, AI: ${(aiResult.confidence * 100).toFixed(1)}%) → ${source}`,
    );

    return {
      categoryId: finalCategory.categoryId,
      categoryName: finalCategory.categoryName,
      subCategoryId: finalCategory['subCategoryId'],
      subCategoryName: finalCategory['subCategoryName'],
      confidence: useRag ? ragScore : aiResult.confidence,
      source: source as any,
      ragSearchLogId,
      aiUsageLogId,
      needsSynonymLearning: !useRag,
    };
  }
}

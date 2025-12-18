import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IAIProvider,
  AIProviderType,
  AIProviderStrategy,
  TransactionData,
  UserContext,
} from './ai.interface';
import { OpenAIProvider } from './providers/openai.provider';
import { GoogleGeminiProvider } from './providers/google-gemini.provider';
import { GroqProvider } from './providers/groq.provider';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { RateLimiterService } from '../../common/services/rate-limiter.service';
import { AICacheService } from '../../common/services/ai-cache.service';
import { AIUsageLoggerService } from './ai-usage-logger.service';
import { AINormalizationService } from './ai-normalization.service';
import { AIConfigService } from './ai-config.service';
import { AIOperationType, AIInputType } from '@prisma/client';

/**
 * Factory para criação e gerenciamento de AI Providers
 *
 * ESTRATÉGIA MIX-AND-MATCH:
 * Permite usar diferentes IAs para diferentes tarefas, otimizando custo e performance.
 *
 * Exemplo de configuração ótima:
 * - Texto: OpenAI GPT-4 (melhor qualidade)
 * - Imagem: Google Gemini (80% mais barato)
 * - Áudio: Groq Whisper (GRÁTIS!)
 * - Categoria: Groq Llama 3 (muito mais barato)
 */
@Injectable()
export class AIProviderFactory {
  private readonly logger = new Logger(AIProviderFactory.name);
  private readonly providers: Map<AIProviderType, IAIProvider> = new Map();

  constructor(
    private readonly configService: ConfigService,
    private readonly openaiProvider: OpenAIProvider,
    private readonly googleGeminiProvider: GoogleGeminiProvider,
    private readonly groqProvider: GroqProvider,
    private readonly deepseekProvider: DeepSeekProvider,
    private readonly rateLimiter: RateLimiterService,
    private readonly aiCache: AICacheService,
    private readonly aiUsageLogger: AIUsageLoggerService,
    private readonly normalizationService: AINormalizationService,
    private readonly aiConfigService: AIConfigService,
  ) {
    // Registrar providers disponíveis
    this.providers.set(AIProviderType.OPENAI, this.openaiProvider);
    this.providers.set(AIProviderType.GOOGLE_GEMINI, this.googleGeminiProvider);
    this.providers.set(AIProviderType.GROQ, this.groqProvider);
    this.providers.set(AIProviderType.DEEPSEEK, this.deepseekProvider);

    this.logger.log('✅ AIProviderFactory inicializado');
    this.logCurrentConfiguration();
  }

  /**
   * Loga a configuração atual dos providers (async)
   */
  private async logCurrentConfiguration() {
    try {
      const settings = await this.aiConfigService.getSettings();
      this.logger.log(`📊 Configuração atual:`);
      this.logger.log(`   - Texto: ${settings.textProvider}`);
      this.logger.log(`   - Imagem: ${settings.imageProvider}`);
      this.logger.log(`   - Áudio: ${settings.audioProvider}`);
      this.logger.log(`   - Categoria: ${settings.categoryProvider}`);
      this.logger.log(`🔄 Fallback: ${settings.fallbackEnabled ? 'HABILITADO' : 'DESABILITADO'}`);
    } catch (error) {
      this.logger.warn('Não foi possível carregar configurações de IA');
    }
  }

  /**
   * Extrai transação de texto usando provider configurado
   * Com rate limiting, cache e fallback
   */
  async extractTransaction(text: string, userContext?: UserContext): Promise<TransactionData> {
    // Buscar provider configurado dinamicamente
    // Usar categoryProvider pois é uma operação de categorização
    const providerType = this.toProviderType(
      await this.aiConfigService.getProviderForOperation('category'),
    );

    // 1. Verificar cache primeiro
    const cached = await this.aiCache.getCachedText(text, providerType, 'extract');
    if (cached && typeof cached === 'object') {
      this.logger.debug(`💾 Usando resultado em cache para texto`);
      return cached as TransactionData;
    }

    // 2. Verificar rate limit
    const canProceed = await this.rateLimiter.checkLimit(providerType, 500);
    if (!canProceed) {
      this.logger.warn(`⚠️  Rate limit atingido para ${providerType}`);

      const settings = await this.aiConfigService.getSettings();
      if (settings.fallbackEnabled) {
        return await this.extractTransactionWithFallback(text, userContext, providerType);
      }

      throw new Error(
        `Rate limit atingido para ${providerType}. Habilite fallback nas configurações.`,
      );
    }

    // 3. Processar com provider
    const provider = this.getProvider(providerType);
    try {
      const rawResult = await provider.extractTransaction(text, userContext);

      // Normalizar dados brutos retornados pelo provider
      const result = this.normalizationService.normalizeTransactionData(rawResult, providerType);

      // 4. Registrar uso e cachear
      await this.rateLimiter.recordUsage(providerType, 500);
      await this.aiCache.cacheText(text, providerType, result, 'extract');

      return result;
    } catch (error) {
      this.logger.error(`Erro no provider ${providerType}: ${error.message}`);

      const settings = await this.aiConfigService.getSettings();
      if (settings.fallbackEnabled) {
        return await this.extractTransactionWithFallback(text, userContext, providerType);
      }

      throw new Error(
        `Falha ao processar com ${providerType}. Configure AI_FALLBACK_ENABLED=true para usar fallback automático. Erro: ${error.message}`,
      );
    }
  }

  /**
   * Analisa imagem usando provider configurado (recomendado: Gemini)
   * Com rate limiting, cache e fallback
   */
  async analyzeImage(imageBuffer: Buffer, mimeType: string): Promise<TransactionData> {
    // Buscar provider configurado dinamicamente
    const providerType = this.toProviderType(
      await this.aiConfigService.getProviderForOperation('image'),
    );

    // 1. Verificar cache
    const cached = await this.aiCache.getCachedBuffer(imageBuffer, providerType, 'image');
    if (cached && typeof cached === 'object') {
      this.logger.debug(`💾 Usando resultado em cache para imagem`);
      return cached as TransactionData;
    }

    // 2. Verificar rate limit (imagens usam mais tokens)
    const canProceed = await this.rateLimiter.checkLimit(providerType, 1000);
    if (!canProceed) {
      this.logger.warn(`⚠️  Rate limit atingido para ${providerType}`);

      const settings = await this.aiConfigService.getSettings();
      if (settings.fallbackEnabled) {
        return await this.analyzeImageWithFallback(imageBuffer, mimeType, providerType);
      }

      throw new Error(
        `Rate limit atingido para ${providerType}. Habilite fallback nas configurações.`,
      );
    }

    // 3. Processar
    const provider = this.getProvider(providerType);
    try {
      const rawResult = await provider.analyzeImage(imageBuffer, mimeType);

      // Normalizar dados brutos retornados pelo provider
      const result = this.normalizationService.normalizeTransactionData(rawResult, providerType);

      // 4. Registrar e cachear
      await this.rateLimiter.recordUsage(providerType, 1000);
      await this.aiCache.cacheBuffer(imageBuffer, providerType, result, 'image');

      return result;
    } catch (error) {
      this.logger.error(`Erro no provider ${providerType}: ${error.message}`);

      const settings = await this.aiConfigService.getSettings();
      if (settings.fallbackEnabled) {
        return await this.analyzeImageWithFallback(imageBuffer, mimeType, providerType);
      }

      throw new Error(
        `Falha ao processar imagem com ${providerType}. Habilite fallback nas configurações. Erro: ${error.message}`,
      );
    }
  }

  /**
   * Transcreve áudio usando provider configurado (recomendado: Groq GRÁTIS)
   * Com rate limiting, cache e fallback
   */
  async transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<string> {
    // Buscar provider configurado dinamicamente
    const providerType = this.toProviderType(
      await this.aiConfigService.getProviderForOperation('audio'),
    );

    // 1. Verificar cache
    const cached = await this.aiCache.getCachedBuffer(audioBuffer, providerType, 'audio');
    if (cached && typeof cached === 'string') {
      this.logger.debug(`💾 Usando transcrição em cache`);
      return cached;
    }

    // 2. Verificar rate limit
    const canProceed = await this.rateLimiter.checkLimit(providerType, 800);
    if (!canProceed) {
      this.logger.warn(`⚠️  Rate limit atingido para ${providerType}`);

      const settings = await this.aiConfigService.getSettings();
      if (settings.fallbackEnabled) {
        return await this.transcribeAudioWithFallback(audioBuffer, mimeType, providerType);
      }

      throw new Error(
        `Rate limit atingido para ${providerType}. Habilite fallback nas configurações.`,
      );
    }

    // 3. Processar
    const provider = this.getProvider(providerType);
    try {
      const result = await provider.transcribeAudio(audioBuffer, mimeType);

      // 4. Registrar e cachear
      await this.rateLimiter.recordUsage(providerType, 800);
      await this.aiCache.cacheBuffer(audioBuffer, providerType, result, 'audio');

      return result;
    } catch (error) {
      this.logger.error(`Erro no provider ${providerType}: ${error.message}`);

      const settings = await this.aiConfigService.getSettings();
      if (settings.fallbackEnabled) {
        return await this.transcribeAudioWithFallback(audioBuffer, mimeType, providerType);
      }

      throw new Error(
        `Falha ao transcrever áudio com ${providerType}. Habilite fallback nas configurações. Erro: ${error.message}`,
      );
    }
  }

  /**
   * Sugere categoria usando provider configurado (recomendado: Groq)
   * Com rate limiting, cache e fallback
   */
  async suggestCategory(description: string, userCategories: string[]): Promise<string> {
    // Buscar provider configurado dinamicamente
    const providerType = this.toProviderType(
      await this.aiConfigService.getProviderForOperation('category'),
    );

    // 1. Verificar cache
    const cacheKey = `${description}|${userCategories.join(',')}`;
    const cached = await this.aiCache.getCachedText(cacheKey, providerType, 'category');
    if (cached && typeof cached === 'string') {
      this.logger.debug(`💾 Usando categoria em cache`);
      return cached;
    }

    // 2. Verificar rate limit
    const canProceed = await this.rateLimiter.checkLimit(providerType, 200);
    if (!canProceed) {
      this.logger.warn(`⚠️  Rate limit atingido para ${providerType}`);

      const settings = await this.aiConfigService.getSettings();
      if (settings.fallbackEnabled) {
        const fallbackChain = await this.aiConfigService.getFallbackChainForOperation('category');
        const filteredChain = fallbackChain
          .map((p) => this.toProviderType(p))
          .filter((p) => p !== providerType);

        for (const fallbackProviderType of filteredChain) {
          try {
            this.logger.log(`🔄 Tentando fallback: ${fallbackProviderType}`);
            const fallbackProvider = this.getProvider(fallbackProviderType);
            const result = await fallbackProvider.suggestCategory(description, userCategories);
            await this.rateLimiter.recordUsage(fallbackProviderType, 200);
            await this.aiCache.cacheText(cacheKey, fallbackProviderType, result, 'category');
            return result;
          } catch (_fallbackError) {
            this.logger.error(`Falha no fallback ${fallbackProviderType}`);
          }
        }
      }

      return 'Outros';
    }

    // 3. Processar
    const provider = this.getProvider(providerType);
    try {
      const result = await provider.suggestCategory(description, userCategories);

      // 4. Registrar e cachear
      await this.rateLimiter.recordUsage(providerType, 200);
      await this.aiCache.cacheText(cacheKey, providerType, result, 'category');

      return result;
    } catch (error) {
      this.logger.error(`Erro no provider ${providerType}: ${error.message}`);

      const settings = await this.aiConfigService.getSettings();
      if (settings.fallbackEnabled) {
        const fallbackChain = await this.aiConfigService.getFallbackChainForOperation('category');
        const filteredChain = fallbackChain
          .map((p) => this.toProviderType(p))
          .filter((p) => p !== providerType);

        for (const fallbackProviderType of filteredChain) {
          try {
            this.logger.log(`🔄 Tentando fallback: ${fallbackProviderType}`);
            const fallbackProvider = this.getProvider(fallbackProviderType);
            const result = await fallbackProvider.suggestCategory(description, userCategories);
            await this.rateLimiter.recordUsage(fallbackProviderType, 200);
            await this.aiCache.cacheText(cacheKey, fallbackProviderType, result, 'category');
            return result;
          } catch (_fallbackError) {
            this.logger.error(`Falha no fallback ${fallbackProviderType}`);
          }
        }
      }

      this.logger.error(`Erro no provider ${providerType} para categoria. Retornando 'Outros'`);
      return 'Outros';
    }
  }

  /**
   * Converte nome do provider (string) para AIProviderType
   */
  private toProviderType(providerName: string): AIProviderType {
    return providerName as AIProviderType;
  }

  /**
   * Obtém provider específico
   * Suporta string (ex: "openai") ou AIProviderType enum
   */
  getProvider(type: AIProviderType | string): IAIProvider {
    // Converter string para AIProviderType se necessário
    let providerType: AIProviderType;
    if (typeof type === 'string') {
      providerType =
        AIProviderType[type.toUpperCase().replace('-', '_') as keyof typeof AIProviderType];
      if (!providerType) {
        this.logger.warn(`Provider tipo "${type}" não reconhecido, usando OPENAI como fallback`);
        providerType = AIProviderType.OPENAI;
      }
    } else {
      providerType = type;
    }

    const provider = this.providers.get(providerType);
    if (!provider) {
      throw new Error(`Provider ${providerType} não encontrado`);
    }
    return provider;
  }

  /**
   * Fallback para extração de texto usando cadeia configurada
   */
  private async extractTransactionWithFallback(
    text: string,
    userContext: UserContext | undefined,
    failedProvider: AIProviderType,
  ): Promise<TransactionData> {
    // Buscar cadeia de fallback configurada
    const fallbackChain = await this.aiConfigService.getFallbackChainForOperation('text');
    const filteredChain = fallbackChain
      .map((p) => this.toProviderType(p))
      .filter((p) => p !== failedProvider);

    for (const providerType of filteredChain) {
      try {
        this.logger.log(`🔄 Tentando fallback com ${providerType}...`);
        const provider = this.getProvider(providerType);
        const rawResult = await provider.extractTransaction(text, userContext);

        // Normalizar dados brutos retornados pelo provider
        const result = this.normalizationService.normalizeTransactionData(rawResult, providerType);

        // Registrar uso e cachear resultado do fallback
        await this.rateLimiter.recordUsage(providerType, 500);
        await this.aiCache.cacheText(text, providerType, result, 'extract');

        return result;
      } catch (error) {
        this.logger.warn(`Fallback com ${providerType} também falhou`);
      }
    }

    throw new Error('Todos os providers falharam ao extrair transação');
  }

  /**
   * Fallback para análise de imagem usando cadeia configurada
   */
  private async analyzeImageWithFallback(
    imageBuffer: Buffer,
    mimeType: string,
    failedProvider: AIProviderType,
  ): Promise<TransactionData> {
    // Buscar cadeia de fallback configurada
    const fallbackChain = await this.aiConfigService.getFallbackChainForOperation('image');
    const filteredChain = fallbackChain
      .map((p) => this.toProviderType(p))
      .filter((p) => p !== failedProvider);

    for (const providerType of filteredChain) {
      try {
        this.logger.log(`🔄 Tentando fallback de imagem com ${providerType}...`);
        const provider = this.getProvider(providerType);
        const rawResult = await provider.analyzeImage(imageBuffer, mimeType);

        // Normalizar dados brutos retornados pelo provider
        const result = this.normalizationService.normalizeTransactionData(rawResult, providerType);

        // Registrar uso e cachear resultado do fallback
        await this.rateLimiter.recordUsage(providerType, 1000);
        await this.aiCache.cacheBuffer(imageBuffer, providerType, result, 'image');

        return result;
      } catch (error) {
        this.logger.warn(`Fallback de imagem com ${providerType} falhou`);
      }
    }

    throw new Error('Todos os providers falharam ao analisar imagem');
  }

  /**
   * Fallback para transcrição de áudio usando cadeia configurada
   */
  private async transcribeAudioWithFallback(
    audioBuffer: Buffer,
    mimeType: string,
    failedProvider: AIProviderType,
  ): Promise<string> {
    // Buscar cadeia de fallback configurada
    const fallbackChain = await this.aiConfigService.getFallbackChainForOperation('audio');
    const filteredChain = fallbackChain
      .map((p) => this.toProviderType(p))
      .filter((p) => p !== failedProvider);

    for (const providerType of filteredChain) {
      try {
        this.logger.log(`🔄 Tentando fallback de áudio com ${providerType}...`);
        const provider = this.getProvider(providerType);
        const result = await provider.transcribeAudio(audioBuffer, mimeType);

        // Registrar uso e cachear resultado do fallback
        await this.rateLimiter.recordUsage(providerType, 800);
        await this.aiCache.cacheBuffer(audioBuffer, providerType, result, 'audio');

        return result;
      } catch (error) {
        this.logger.warn(`Fallback de áudio com ${providerType} falhou`);
      }
    }

    throw new Error('Todos os providers falharam ao transcrever áudio');
  }

  /**
   * Registra uso de IA para auditoria
   * Método público para ser chamado pelos serviços
   */
  async logAIUsage(params: {
    phoneNumber: string;
    userCacheId?: string;
    operation: AIOperationType;
    inputType: AIInputType;
    inputText?: string;
    inputTokens: number;
    outputTokens: number;
    metadata?: any;
  }): Promise<void> {
    const providerType = await this.getProviderTypeForOperation(params.operation);
    const model = this.getModelNameForProvider(providerType);

    await this.aiUsageLogger.logUsage({
      phoneNumber: params.phoneNumber,
      userCacheId: params.userCacheId,
      provider: providerType,
      model,
      operation: params.operation,
      inputType: params.inputType,
      inputText: params.inputText,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      totalTokens: params.inputTokens + params.outputTokens,
      estimatedCost: 0, // Será calculado automaticamente
      metadata: params.metadata,
    });
  }

  /**
   * Obtém tipo de provider para uma operação
   */
  private async getProviderTypeForOperation(operation: AIOperationType): Promise<string> {
    switch (operation) {
      case 'TRANSACTION_EXTRACTION':
        return await this.aiConfigService.getProviderForOperation('text');
      case 'IMAGE_ANALYSIS':
        return await this.aiConfigService.getProviderForOperation('image');
      case 'AUDIO_TRANSCRIPTION':
        return await this.aiConfigService.getProviderForOperation('audio');
      case 'CATEGORY_SUGGESTION':
        return await this.aiConfigService.getProviderForOperation('category');
      default:
        return await this.aiConfigService.getProviderForOperation('text');
    }
  }

  /**
   * Obtém nome do modelo para um provider
   */
  private getModelNameForProvider(providerType: string): string {
    const modelMap = {
      [AIProviderType.OPENAI]: this.configService.get('ai.openai.model', 'gpt-4o-mini'),
      [AIProviderType.GOOGLE_GEMINI]: this.configService.get('ai.gemini.model', 'gemini-1.5-flash'),
      [AIProviderType.GROQ]: this.configService.get('ai.groq.model', 'llama-3.1-70b'),
    };
    return modelMap[providerType] || 'unknown';
  }
}

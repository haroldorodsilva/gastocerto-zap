import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
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
import { AICredentialSelectorService } from './credentials/ai-credential-selector.service';
import { aiCredentialContext } from './credentials/ai-credential.context';
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
export class AIProviderFactory implements OnModuleInit {
  private readonly logger = new Logger(AIProviderFactory.name);
  private readonly providers: Map<AIProviderType, IAIProvider> = new Map();

  /**
   * Circuit Breaker — rastreia falhas consecutivas por provider.
   * Quando um provider falha N vezes seguidas, é marcado como "aberto" (indisponível)
   * por um período de cooldown antes de tentar novamente (half-open).
   */
  private readonly circuitState = new Map<
    AIProviderType,
    { failures: number; lastFailure: number; state: 'closed' | 'open' | 'half-open' }
  >();
  private readonly CIRCUIT_FAILURE_THRESHOLD = 3;
  private readonly CIRCUIT_COOLDOWN_MS = 60_000; // 1 min

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
    private readonly credentialSelector: AICredentialSelectorService,
  ) {
    // Registrar providers disponíveis
    this.providers.set(AIProviderType.OPENAI, this.openaiProvider);
    this.providers.set(AIProviderType.GOOGLE_GEMINI, this.googleGeminiProvider);
    this.providers.set(AIProviderType.GROQ, this.groqProvider);
    this.providers.set(AIProviderType.DEEPSEEK, this.deepseekProvider);

    // Inicializar circuit state
    for (const type of this.providers.keys()) {
      this.circuitState.set(type, { failures: 0, lastFailure: 0, state: 'closed' });
    }

    this.logger.log('✅ AIProviderFactory inicializado');
  }

  async onModuleInit(): Promise<void> {
    await this.logCurrentConfiguration();
  }

  /**
   * Verifica se o circuit breaker está aberto para um provider
   */
  isCircuitOpen(providerType: AIProviderType): boolean {
    const state = this.circuitState.get(providerType);
    if (!state || state.state === 'closed') return false;

    if (state.state === 'open') {
      const elapsed = Date.now() - state.lastFailure;
      if (elapsed > this.CIRCUIT_COOLDOWN_MS) {
        // Transição para half-open — permite 1 tentativa
        state.state = 'half-open';
        this.logger.log(`🔄 Circuit breaker HALF-OPEN para ${providerType}`);
        return false;
      }
      return true; // Ainda em cooldown
    }
    return false; // half-open — deixar tentar
  }

  /**
   * Registra sucesso — fecha o circuit
   */
  recordSuccess(providerType: AIProviderType): void {
    const state = this.circuitState.get(providerType);
    if (state && state.state !== 'closed') {
      this.logger.log(`✅ Circuit breaker CLOSED para ${providerType}`);
    }
    this.circuitState.set(providerType, { failures: 0, lastFailure: 0, state: 'closed' });
  }

  /**
   * Registra falha — pode abrir o circuit
   */
  recordFailure(providerType: AIProviderType): void {
    const state = this.circuitState.get(providerType) || { failures: 0, lastFailure: 0, state: 'closed' as const };
    state.failures++;
    state.lastFailure = Date.now();

    if (state.failures >= this.CIRCUIT_FAILURE_THRESHOLD) {
      state.state = 'open';
      this.logger.warn(
        `🔴 Circuit breaker OPEN para ${providerType} após ${state.failures} falhas consecutivas`,
      );
    }
    this.circuitState.set(providerType, state);
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
    const providerType = this.toProviderType(
      await this.aiConfigService.getProviderForOperation('text'),
    );

    // 1. Verificar cache primeiro
    const cached = await this.aiCache.getCachedText(text, providerType, 'extract');
    if (cached && typeof cached === 'object') {
      this.logger.debug(`💾 Usando resultado em cache para texto`);
      return cached as TransactionData;
    }

    // 2. Verificar circuit breaker
    if (this.isCircuitOpen(providerType)) {
      this.logger.warn(`🔴 Circuit OPEN para ${providerType}, indo para fallback`);
      const settings = await this.aiConfigService.getSettings();
      if (settings.fallbackEnabled) {
        return await this.extractTransactionWithFallback(text, userContext, providerType);
      }
      throw new Error(`Provider ${providerType} indisponível (circuit open). Habilite fallback.`);
    }

    // 3. Verificar rate limit
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

    // 4. Processar com provider
    const provider = this.getProvider(providerType);
    try {
      const rawResult = await this.runWithCredentialRotation(providerType, () =>
        provider.extractTransaction(text, userContext),
      );

      // Normalizar dados brutos retornados pelo provider
      const result = this.normalizationService.normalizeTransactionData(rawResult, providerType);

      // 5. Registrar uso, cachear e fechar circuit
      await this.rateLimiter.recordUsage(providerType, 500);
      await this.aiCache.cacheText(text, providerType, result, 'extract');
      this.recordSuccess(providerType);

      return result;
    } catch (error) {
      this.logger.error(`Erro no provider ${providerType}: ${error.message}`);
      this.recordFailure(providerType);

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
      const rawResult = await this.runWithCredentialRotation(providerType, () =>
        provider.analyzeImage(imageBuffer, mimeType),
      );

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
      const result = await this.runWithCredentialRotation(providerType, () =>
        provider.transcribeAudio(audioBuffer, mimeType),
      );

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
            const result = await this.runWithCredentialRotation(fallbackProviderType, () =>
              fallbackProvider.suggestCategory(description, userCategories),
            );
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
      const result = await this.runWithCredentialRotation(providerType, () =>
        provider.suggestCategory(description, userCategories),
      );

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
            const result = await this.runWithCredentialRotation(fallbackProviderType, () =>
              fallbackProvider.suggestCategory(description, userCategories),
            );
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
   * 🆕 [AI3/AI4] Executa `fn` com rotação round-robin de credenciais.
   *
   * - Lista credenciais ativas (não esgotadas) ordenadas por priority+lastUsed.
   * - Para cada uma, executa `fn` dentro de `aiCredentialContext.run`.
   * - Em quota/rate-limit: marca como esgotada e tenta a próxima.
   * - Em outro erro: marca erro e propaga (deixa o fallback de provider lidar).
   * - Se nenhuma credencial: lança erro (provider considerado indisponível).
   */
  private async runWithCredentialRotation<T>(
    providerType: AIProviderType,
    fn: () => Promise<T>,
  ): Promise<T> {
    const creds = await this.credentialSelector.listAvailable(providerType);
    if (creds.length === 0) {
      throw new Error(
        `Nenhuma credencial disponível para provider=${providerType} (todas esgotadas ou desabilitadas)`,
      );
    }

    let lastError: any;
    for (const cred of creds) {
      try {
        const result = await aiCredentialContext.run(cred, () => fn());
        await this.credentialSelector.markUsed(cred.credentialId);
        return result;
      } catch (err) {
        lastError = err;
        if (AICredentialSelectorService.isQuotaError(err)) {
          await this.credentialSelector.markExhausted(
            cred.credentialId,
            (err as Error)?.message || 'quota/rate limit',
          );
          this.logger.warn(
            `🔁 Rotação: ${providerType}/${cred.label} esgotada, tentando próxima credencial...`,
          );
          continue;
        }
        await this.credentialSelector.markError(cred.credentialId);
        throw err;
      }
    }

    throw new Error(
      `Todas as credenciais de ${providerType} esgotaram. Último erro: ${(lastError as Error)?.message || 'desconhecido'}`,
    );
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
        const rawResult = await this.runWithCredentialRotation(providerType, () =>
          provider.extractTransaction(text, userContext),
        );

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
        const rawResult = await this.runWithCredentialRotation(providerType, () =>
          provider.analyzeImage(imageBuffer, mimeType),
        );

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
        const result = await this.runWithCredentialRotation(providerType, () =>
          provider.transcribeAudio(audioBuffer, mimeType),
        );

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
    gastoCertoId?: string;
    platform?: string;
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
      gastoCertoId: params.gastoCertoId,
      platform: params.platform,
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

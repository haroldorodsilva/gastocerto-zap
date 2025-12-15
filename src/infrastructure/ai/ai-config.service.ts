import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';
import { AIProviderConfig, AISettings } from '@prisma/client';

/**
 * Serviço para gerenciar configurações de provedores de IA
 * Permite configuração dinâmica via banco de dados
 */
@Injectable()
export class AIConfigService {
  private readonly logger = new Logger(AIConfigService.name);
  private configCache: Map<string, AIProviderConfig> = new Map();
  private cacheTimestamp: number = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutos

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Busca configuração de um provider específico
   */
  async getProviderConfig(provider: string): Promise<AIProviderConfig | null> {
    await this.ensureCacheValid();
    return this.configCache.get(provider) || null;
  }

  /**
   * Busca todos os providers habilitados ordenados por prioridade
   */
  async getEnabledProviders(): Promise<AIProviderConfig[]> {
    await this.ensureCacheValid();
    return Array.from(this.configCache.values())
      .filter((config) => config.enabled)
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Busca providers habilitados para uma operação específica
   */
  async getProvidersForOperation(
    operation: 'text' | 'vision' | 'audio',
  ): Promise<AIProviderConfig[]> {
    const enabled = await this.getEnabledProviders();

    switch (operation) {
      case 'vision':
        return enabled.filter((config) => config.supportsVision);
      case 'audio':
        return enabled.filter((config) => config.supportsAudio);
      case 'text':
      default:
        return enabled.filter((config) => config.textModel);
    }
  }

  /**
   * Busca sequência de fallback para uma operação
   */
  async getFallbackChain(operation: 'text' | 'vision' | 'audio'): Promise<AIProviderConfig[]> {
    const providers = await this.getProvidersForOperation(operation);
    return providers.filter((config) => config.fallbackEnabled);
  }

  /**
   * Atualiza configuração de um provider
   */
  async updateProviderConfig(
    provider: string,
    data: Partial<AIProviderConfig>,
  ): Promise<AIProviderConfig> {
    const updated = await this.prisma.aIProviderConfig.update({
      where: { provider },
      data: {
        ...data,
        updatedAt: new Date(),
      },
    });

    // Invalida cache
    this.invalidateCache();

    this.logger.log(`✅ Configuração atualizada para provider: ${provider}`);
    return updated;
  }

  /**
   * Incrementa contador de uso de um provider
   */
  async incrementUsage(provider: string, success: boolean): Promise<void> {
    try {
      await this.prisma.aIProviderConfig.update({
        where: { provider },
        data: {
          totalRequests: { increment: 1 },
          totalErrors: success ? undefined : { increment: 1 },
          lastUsedAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.error(`Erro ao incrementar uso do provider ${provider}:`, error);
    }
  }

  /**
   * Calcula custo estimado de uma requisição
   */
  calculateCost(
    provider: AIProviderConfig,
    inputTokens: number,
    outputTokens: number,
    cacheHit: boolean = false,
  ): number {
    if (!provider.inputCostPer1M || !provider.outputCostPer1M) {
      return 0;
    }

    const inputCost =
      cacheHit && provider.cacheCostPer1M
        ? (inputTokens / 1_000_000) * parseFloat(provider.cacheCostPer1M.toString())
        : (inputTokens / 1_000_000) * parseFloat(provider.inputCostPer1M.toString());

    const outputCost = (outputTokens / 1_000_000) * parseFloat(provider.outputCostPer1M.toString());

    return inputCost + outputCost;
  }

  /**
   * Verifica se provider está dentro dos limites de rate limit
   */
  async checkRateLimit(provider: string): Promise<{ allowed: boolean; message?: string }> {
    const config = await this.getProviderConfig(provider);

    if (!config) {
      return { allowed: false, message: 'Provider não encontrado' };
    }

    if (!config.enabled) {
      return { allowed: false, message: 'Provider desabilitado' };
    }

    // TODO: Implementar lógica real de rate limiting com Redis
    // Por enquanto, apenas verifica se está habilitado
    return { allowed: true };
  }

  /**
   * Garante que o cache está válido
   */
  private async ensureCacheValid(): Promise<void> {
    const now = Date.now();

    if (this.configCache.size === 0 || now - this.cacheTimestamp > this.CACHE_TTL) {
      await this.refreshCache();
    }
  }

  /**
   * Atualiza cache com dados do banco
   */
  private async refreshCache(): Promise<void> {
    try {
      const configs = await this.prisma.aIProviderConfig.findMany();

      this.configCache.clear();
      configs.forEach((config) => {
        this.configCache.set(config.provider, config);
      });

      this.cacheTimestamp = Date.now();
      this.logger.debug(`✅ Cache de configurações atualizado - ${configs.length} providers`);
    } catch (error) {
      this.logger.error('Erro ao atualizar cache de configurações:', error);
    }
  }

  /**
   * Invalida cache forçando refresh na próxima leitura
   */
  invalidateCache(): void {
    this.cacheTimestamp = 0;
  }

  /**
   * Inicializa providers com configurações padrão se não existirem
   */
  async seedDefaultConfigs(): Promise<void> {
    const defaultConfigs = [
      {
        provider: 'openai',
        displayName: 'OpenAI',
        enabled: false,
        textModel: 'gpt-4o',
        visionModel: 'gpt-4o',
        audioModel: 'whisper-1',
        rpmLimit: 500,
        tpmLimit: 150000,
        inputCostPer1M: 2.5,
        outputCostPer1M: 10.0,
        supportsVision: true,
        supportsAudio: true,
        supportsCache: false,
        priority: 3,
        fallbackEnabled: true,
      },
      {
        provider: 'google_gemini',
        displayName: 'Google Gemini',
        enabled: false,
        textModel: 'gemini-1.5-pro',
        visionModel: 'gemini-1.5-pro',
        rpmLimit: 1000,
        tpmLimit: 1000000,
        inputCostPer1M: 1.25,
        outputCostPer1M: 5.0,
        supportsVision: true,
        supportsAudio: false,
        supportsCache: true,
        cacheEnabled: false,
        priority: 2,
        fallbackEnabled: true,
      },
      {
        provider: 'groq',
        displayName: 'Groq',
        enabled: false,
        textModel: 'llama-3.1-70b-versatile',
        rpmLimit: 30,
        tpmLimit: 6000,
        inputCostPer1M: 0.59,
        outputCostPer1M: 0.79,
        supportsVision: false,
        supportsAudio: false,
        supportsCache: false,
        priority: 1,
        fallbackEnabled: true,
      },
      {
        provider: 'deepseek',
        displayName: 'DeepSeek',
        enabled: false,
        baseUrl: 'https://api.deepseek.com',
        textModel: 'deepseek-chat',
        rpmLimit: 60,
        tpmLimit: 1000000,
        inputCostPer1M: 0.28,
        outputCostPer1M: 0.42,
        cacheCostPer1M: 0.028,
        supportsVision: false,
        supportsAudio: false,
        supportsCache: true,
        cacheEnabled: false,
        priority: 1,
        fallbackEnabled: true,
      },
    ];

    for (const config of defaultConfigs) {
      const existing = await this.prisma.aIProviderConfig.findUnique({
        where: { provider: config.provider },
      });

      if (!existing) {
        await this.prisma.aIProviderConfig.create({
          data: config as any,
        });
        this.logger.log(`✅ Provider padrão criado: ${config.displayName}`);
      }
    }
  }

  // ==================== AISettings Methods ====================

  /**
   * Busca configurações globais de IA
   * Cria registro padrão se não existir
   */
  async getSettings(): Promise<AISettings> {
    let settings = await this.prisma.aISettings.findFirst();

    if (!settings) {
      // Criar configuração padrão se não existir
      settings = await this.prisma.aISettings.create({
        data: {
          textProvider: 'openai',
          imageProvider: 'google_gemini',
          audioProvider: 'groq',
          categoryProvider: 'groq',
          primaryProvider: 'openai',
          fallbackEnabled: true,
          fallbackTextChain: ['openai', 'groq', 'deepseek', 'google_gemini'],
          fallbackImageChain: ['google_gemini', 'openai'],
          fallbackAudioChain: ['groq', 'openai'],
          fallbackCategoryChain: ['groq', 'deepseek', 'google_gemini', 'openai'],
          cacheEnabled: false,
          cacheTTL: 3600,
          rateLimitEnabled: true,
        },
      });
      this.logger.log('✅ Configurações padrões de IA criadas');
    }

    return settings;
  }

  /**
   * Atualiza configurações globais de IA
   */
  async updateSettings(data: Partial<AISettings>): Promise<AISettings> {
    // Busca ou cria settings
    let settings = await this.prisma.aISettings.findFirst();

    if (!settings) {
      // Se não existe, cria com os dados fornecidos
      settings = await this.prisma.aISettings.create({
        data: {
          primaryProvider: data.primaryProvider || 'groq',
          fallbackEnabled: data.fallbackEnabled ?? true,
          fallbackTextChain: data.fallbackTextChain || [
            'groq',
            'deepseek',
            'google_gemini',
            'openai',
          ],
          fallbackImageChain: data.fallbackImageChain || ['google_gemini', 'openai'],
          fallbackAudioChain: data.fallbackAudioChain || ['openai', 'groq'],
          fallbackCategoryChain: data.fallbackCategoryChain || [
            'groq',
            'deepseek',
            'google_gemini',
            'openai',
          ],
          cacheEnabled: data.cacheEnabled ?? false,
          cacheTTL: data.cacheTTL || 3600,
          rateLimitEnabled: data.rateLimitEnabled ?? true,
        },
      });
    } else {
      // Atualiza configurações existentes
      settings = await this.prisma.aISettings.update({
        where: { id: settings.id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    }

    this.logger.log('✅ Configurações de IA atualizadas');
    return settings;
  }

  /**
   * Busca o provider primário configurado
   * @deprecated Use getProviderForOperation() instead
   */
  async getPrimaryProvider(): Promise<string> {
    const settings = await this.getSettings();
    return settings.primaryProvider;
  }

  /**
   * Busca o provider configurado para um tipo de operação específico
   */
  async getProviderForOperation(
    operation: 'text' | 'image' | 'audio' | 'category',
  ): Promise<string> {
    const settings = await this.getSettings();

    switch (operation) {
      case 'text':
        return settings.textProvider;
      case 'image':
        return settings.imageProvider;
      case 'audio':
        return settings.audioProvider;
      case 'category':
        return settings.categoryProvider;
      default:
        return settings.textProvider;
    }
  }

  /**
   * Busca a cadeia de fallback para um tipo de operação
   */
  async getFallbackChainForOperation(
    operation: 'text' | 'image' | 'audio' | 'category',
  ): Promise<string[]> {
    const settings = await this.getSettings();

    if (!settings.fallbackEnabled) {
      return [];
    }

    switch (operation) {
      case 'text':
        return settings.fallbackTextChain;
      case 'image':
        return settings.fallbackImageChain;
      case 'audio':
        return settings.fallbackAudioChain;
      case 'category':
        return settings.fallbackCategoryChain;
      default:
        return settings.fallbackTextChain;
    }
  }

  /**
   * Verifica se o cache está habilitado
   */
  async isCacheEnabled(): Promise<boolean> {
    const settings = await this.getSettings();
    return settings.cacheEnabled;
  }

  /**
   * Busca o TTL do cache em segundos
   */
  async getCacheTTL(): Promise<number> {
    const settings = await this.getSettings();
    return settings.cacheTTL;
  }

  /**
   * Verifica se rate limit está habilitado
   */
  async isRateLimitEnabled(): Promise<boolean> {
    const settings = await this.getSettings();
    return settings.rateLimitEnabled;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { IAIProvider, TransactionData, UserContext, AIProviderType } from '../ai.interface';
import {
  TRANSACTION_SYSTEM_PROMPT,
  TRANSACTION_USER_PROMPT_TEMPLATE,
} from '../../../features/transactions/contexts/registration/prompts/transaction-extraction.prompt';
import {
  CATEGORY_SUGGESTION_SYSTEM_PROMPT,
  CATEGORY_SUGGESTION_USER_PROMPT_TEMPLATE,
} from '../../../features/transactions/contexts/registration/prompts/category-suggestion.prompt';

/**
 * DeepSeek AI Provider
 *
 * Pricing (per 1M tokens):
 * - Input (cache miss): $0.28
 * - Input (cache hit): $0.028
 * - Output: $0.42
 *
 * Models:
 * - deepseek-chat: Non-thinking mode (128K context, 8K max output)
 * - deepseek-reasoner: Thinking mode (128K context, 64K max output)
 *
 * Base URL: https://api.deepseek.com
 * Compatible with OpenAI SDK
 */
@Injectable()
export class DeepSeekProvider implements IAIProvider {
  private readonly logger = new Logger(DeepSeekProvider.name);
  private client: OpenAI;
  private model: string;
  private readonly baseUrl: string;
  private apiKey: string;
  private initialized = false;

  constructor(private configService: ConfigService) {
    this.baseUrl = this.configService.get<string>(
      'ai.deepseek.baseUrl',
      'https://api.deepseek.com',
    );
    this.model = this.configService.get<string>('ai.deepseek.model', 'deepseek-chat');

    // Inicializar com dummy key temporariamente
    this.client = new OpenAI({
      apiKey: 'sk-dummy-key-not-configured',
      baseURL: this.baseUrl,
    });
  }

  /**
   * Inicializa o provider buscando config do banco de dados
   * Fallback para ENV se não encontrar no banco
   */
  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Importação dinâmica para evitar dependência circular
      const { PrismaService } = await import('../../../core/database/prisma.service');
      const prisma = new PrismaService();

      const providerConfig = await prisma.aIProviderConfig.findUnique({
        where: { provider: 'deepseek' },
      });

      if (providerConfig?.apiKey && providerConfig.enabled) {
        // Usar configuração do banco
        this.apiKey = providerConfig.apiKey;
        this.model = providerConfig.textModel || this.model;
        this.logger.log(`✅ DeepSeek Provider inicializado via BANCO - Modelo: ${this.model}`);
      } else {
        // Fallback para ENV (desenvolvimento)
        this.apiKey = this.configService.get<string>('ai.deepseek.apiKey');
        if (this.apiKey) {
          this.logger.warn(
            '⚠️  DeepSeek usando ENV (configure no banco para produção) - Modelo: ' + this.model,
          );
        } else {
          this.logger.warn('⚠️  DeepSeek API Key não configurada - Provider desabilitado');
        }
      }

      // Reinicializar cliente com API key correta
      if (this.apiKey) {
        this.client = new OpenAI({
          apiKey: this.apiKey,
          baseURL: this.baseUrl,
        });
      }

      this.initialized = true;
    } catch (error) {
      this.logger.error('Erro ao inicializar DeepSeek Provider:', error);
      this.initialized = true; // Marcar como inicializado mesmo com erro
    }
  }

  /**
   * Verifica se o provider está disponível
   */
  private async isAvailable(): Promise<boolean> {
    await this.initialize();
    return !!this.apiKey;
  }

  /**
   * Extrai dados de transação de texto
   */
  async extractTransaction(text: string, userContext?: UserContext): Promise<TransactionData> {
    if (!(await this.isAvailable())) {
      throw new Error('DeepSeek Provider não está disponível (API Key não configurada)');
    }

    try {
      const startTime = Date.now();
      this.logger.debug(`Extraindo transação de: "${text}"`);

      const userPrompt = TRANSACTION_USER_PROMPT_TEMPLATE(text, userContext?.categories);

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: TRANSACTION_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 500,
      });

      const result = JSON.parse(response.choices[0].message.content || '{}');
      const processingTime = Date.now() - startTime;

      this.logger.log(
        `✅ Transação extraída em ${processingTime}ms - Tipo: ${result.type}, Valor: ${result.amount}`,
      );

      return result;
    } catch (error) {
      this.logger.error('Erro ao extrair transação:', error);
      throw error;
    }
  }

  /**
   * Analisa imagem (NFe, comprovante)
   * Nota: DeepSeek não suporta visão nativamente, deve usar fallback
   */
  async analyzeImage(_imageBuffer: Buffer, _mimeType: string): Promise<TransactionData> {
    throw new Error('DeepSeek não suporta análise de imagem - use um provider com visão');
  }

  /**
   * Transcreve áudio
   * Nota: DeepSeek não suporta áudio nativamente, deve usar fallback
   */
  async transcribeAudio(_audioBuffer: Buffer, _mimeType: string): Promise<string> {
    throw new Error('DeepSeek não suporta transcrição de áudio - use um provider com áudio');
  }

  /**
   * Sugere categoria baseada em descrição
   */
  async suggestCategory(description: string, userCategories: string[]): Promise<string> {
    if (!(await this.isAvailable())) {
      throw new Error('DeepSeek Provider não está disponível (API Key não configurada)');
    }

    try {
      const startTime = Date.now();
      this.logger.debug(`Sugerindo categoria para: "${description}"`);

      const userPrompt = CATEGORY_SUGGESTION_USER_PROMPT_TEMPLATE(description, userCategories);

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: CATEGORY_SUGGESTION_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 100,
      });

      const result = JSON.parse(response.choices[0].message.content || '{}');
      const processingTime = Date.now() - startTime;

      this.logger.log(
        `✅ Categoria sugerida em ${processingTime}ms - Categoria: ${result.category}, Confiança: ${result.confidence}`,
      );

      return result.category || 'Outros';
    } catch (error) {
      this.logger.error('Erro ao sugerir categoria:', error);
      throw error;
    }
  }

  /**
   * Gera embedding vetorial
   * DeepSeek não suporta embeddings nativamente
   */
  async generateEmbedding(text: string): Promise<number[]> {
    throw new Error(
      'DeepSeek não suporta embeddings. Use OpenAI ou Google Gemini para RAG com embeddings.',
    );
  }

  /**
   * Retorna informações do provider
   */
  getProviderInfo() {
    return {
      name: 'DeepSeek',
      type: AIProviderType.DEEPSEEK,
      supportsVision: false,
      supportsAudio: false,
      model: this.model,
      baseUrl: this.baseUrl,
    };
  }
}

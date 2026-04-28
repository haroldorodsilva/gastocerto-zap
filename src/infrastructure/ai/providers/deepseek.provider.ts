import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { CryptoService } from '../../../common/services/crypto.service';
import { PrismaService } from '../../../core/database/prisma.service';
import { IAIProvider, TransactionData, UserContext, AIProviderType } from '../ai.interface';
import { aiCredentialContext } from '../credentials/ai-credential.context';
import {
  TRANSACTION_SYSTEM_PROMPT,
  TRANSACTION_USER_PROMPT_TEMPLATE,
  CATEGORY_SUGGESTION_SYSTEM_PROMPT,
  CATEGORY_SUGGESTION_USER_PROMPT_TEMPLATE,
} from '../prompts';

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
  private model: string;
  private readonly baseUrl: string;
  private modelsLoaded = false;
  /** Cache de clientes por apiKey */
  private clientCache = new Map<string, OpenAI>();

  constructor(
    private configService: ConfigService,
    private cryptoService: CryptoService,
    private prismaService: PrismaService,
  ) {
    this.baseUrl = this.configService.get<string>(
      'ai.deepseek.baseUrl',
      'https://api.deepseek.com',
    );
    this.model = this.configService.get<string>('ai.deepseek.model', 'deepseek-chat');
  }

  /**
   * 🆕 [AI3] Carrega APENAS metadados (modelo) do banco. ApiKey vem do contexto.
   */
  private async loadModels(): Promise<void> {
    if (this.modelsLoaded) return;
    try {
      const cfg = await this.prismaService.aIProviderConfig.findUnique({
        where: { provider: 'deepseek' },
      });
      if (cfg?.textModel) this.model = cfg.textModel;
    } catch (err) {
      this.logger.warn(`DeepSeek: falha ao carregar modelos: ${(err as Error).message}`);
    }
    this.modelsLoaded = true;
  }

  private getActiveClient(): OpenAI {
    const cred = aiCredentialContext.getStore();
    if (!cred) {
      throw new Error('DeepSeekProvider chamado sem credencial no contexto.');
    }
    let client = this.clientCache.get(cred.apiKey);
    if (!client) {
      client = new OpenAI({ apiKey: cred.apiKey, baseURL: this.baseUrl });
      this.clientCache.set(cred.apiKey, client);
    }
    return client;
  }

  /**
   * Verifica se o provider está disponível
   */
  private async isAvailable(): Promise<boolean> {
    await this.loadModels();
    return !!aiCredentialContext.getStore();
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

      const response = await this.getActiveClient().chat.completions.create({
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

      const response = await this.getActiveClient().chat.completions.create({
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

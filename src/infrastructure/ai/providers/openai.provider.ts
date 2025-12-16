import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { IAIProvider, TransactionData, UserContext } from '../ai.interface';
import {
  getTransactionSystemPrompt,
  TRANSACTION_USER_PROMPT_TEMPLATE,
} from '../../../features/transactions/contexts/registration/prompts/transaction-extraction.prompt';
import {
  IMAGE_ANALYSIS_SYSTEM_PROMPT,
  IMAGE_ANALYSIS_USER_PROMPT,
} from '../../../features/transactions/contexts/registration/prompts/image-analysis.prompt';
import {
  CATEGORY_SUGGESTION_SYSTEM_PROMPT,
  CATEGORY_SUGGESTION_USER_PROMPT_TEMPLATE,
} from '../../../features/transactions/contexts/registration/prompts/category-suggestion.prompt';

@Injectable()
export class OpenAIProvider implements IAIProvider {
  private readonly logger = new Logger(OpenAIProvider.name);
  private client: OpenAI;
  private model: string;
  private visionModel: string;
  private whisperModel: string;
  private apiKey: string;
  private initialized = false;

  constructor(private configService: ConfigService) {
    // Inicialização assíncrona será feita no primeiro uso
    this.client = new OpenAI({ apiKey: 'sk-dummy-key-not-configured' });
  }

  /**
   * Inicializa provider com configurações do banco ou ENV
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Tentar buscar do banco primeiro
      const { PrismaService } = await import('../../../core/database/prisma.service');
      const prisma = new PrismaService();
      
      const providerConfig = await prisma.aIProviderConfig.findUnique({
        where: { provider: 'openai' },
      });

      if (providerConfig?.apiKey && providerConfig.enabled) {
        // Usar configuração do banco
        this.apiKey = providerConfig.apiKey;
        this.model = providerConfig.textModel || 'gpt-4o-mini';
        this.visionModel = providerConfig.visionModel || 'gpt-4o';
        this.whisperModel = providerConfig.audioModel || 'whisper-1';
        this.logger.log(`✅ OpenAI Provider inicializado via BANCO - Modelo: ${this.model}`);
      } else {
        // Fallback para ENV (apenas dev)
        this.apiKey = this.configService.get<string>('ai.openai.apiKey', '');
        this.model = this.configService.get<string>('ai.openai.model', 'gpt-4o-mini');
        this.visionModel = this.configService.get<string>('ai.openai.visionModel', 'gpt-4o');
        this.whisperModel = this.configService.get<string>('ai.openai.whisperModel', 'whisper-1');
        
        if (this.apiKey) {
          this.logger.warn('⚠️  OpenAI usando ENV (configure no banco para produção)');
        } else {
          this.logger.warn('⚠️  OpenAI API Key não configurada - Provider desabilitado');
        }
      }

      if (this.apiKey) {
        this.client = new OpenAI({ apiKey: this.apiKey });
      }

      this.initialized = true;
    } catch (error) {
      this.logger.error('Erro ao inicializar OpenAI:', error.message);
      this.initialized = true; // Marcar como iniciado mesmo com erro
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
      throw new Error('OpenAI Provider não está disponível (API Key não configurada)');
    }

    try {
      const startTime = Date.now();
      this.logger.debug(`Extraindo transação de: "${text}"`);

      const userPrompt = TRANSACTION_USER_PROMPT_TEMPLATE(text, userContext?.categories);

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: getTransactionSystemPrompt() },
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
   */
  async analyzeImage(imageBuffer: Buffer, mimeType: string): Promise<TransactionData> {
    if (!(await this.isAvailable())) {
      throw new Error('OpenAI Provider não está disponível (API Key não configurada)');
    }

    try {
      const startTime = Date.now();
      this.logger.log(`Analisando imagem (${(imageBuffer.length / 1024).toFixed(2)} KB)`);

      const base64Image = imageBuffer.toString('base64');

      const response = await this.client.chat.completions.create({
        model: this.visionModel,
        messages: [
          {
            role: 'system',
            content: IMAGE_ANALYSIS_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: IMAGE_ANALYSIS_USER_PROMPT },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`,
                },
              },
            ],
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1000,
      });

      const result = JSON.parse(response.choices[0].message.content || '{}');
      const processingTime = Date.now() - startTime;

      this.logger.log(
        `✅ Imagem analisada em ${processingTime}ms - Valor: ${result.amount}, Confiança: ${result.confidence}`,
      );

      return result;
    } catch (error) {
      this.logger.error('Erro ao analisar imagem:', error);
      throw error;
    }
  }

  /**
   * Transcreve áudio para texto
   */
  async transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<string> {
    if (!(await this.isAvailable())) {
      throw new Error('OpenAI Provider não está disponível (API Key não configurada)');
    }

    try {
      const startTime = Date.now();
      this.logger.log(`Transcrevendo áudio (${(audioBuffer.length / 1024).toFixed(2)} KB)`);

      // Whisper API requer File object
      const file = new File([audioBuffer as any], 'audio.mp3', { type: mimeType });

      const response = await this.client.audio.transcriptions.create({
        file: file,
        model: this.whisperModel,
        language: 'pt',
        response_format: 'text',
      });

      const processingTime = Date.now() - startTime;
      this.logger.log(`✅ Áudio transcrito em ${processingTime}ms`);

      return response as unknown as string;
    } catch (error) {
      this.logger.error('Erro ao transcrever áudio:', error);
      throw error;
    }
  }

  /**
   * Sugere categoria baseada na descrição
   */
  async suggestCategory(description: string, userCategories: string[]): Promise<string> {
    try {
      this.logger.debug(`Sugerindo categoria para: "${description}"`);

      const userPrompt = CATEGORY_SUGGESTION_USER_PROMPT_TEMPLATE(description, userCategories);

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: CATEGORY_SUGGESTION_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 50,
      });

      const category = response.choices[0].message.content?.trim() || 'Outros';

      this.logger.log(`✅ Categoria sugerida: ${category}`);

      return category;
    } catch (error) {
      this.logger.error('Erro ao sugerir categoria:', error);
      return 'Outros';
    }
  }

  /**
   * Gera embedding vetorial de um texto
   * Usa modelo text-embedding-3-small (mais barato e eficiente)
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!(await this.isAvailable())) {
      throw new Error('OpenAI Provider não está disponível (API Key não configurada)');
    }

    try {
      const startTime = Date.now();
      this.logger.debug(`Gerando embedding para: "${text}"`);

      const response = await this.client.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
        encoding_format: 'float',
      });

      const embedding = response.data[0].embedding;
      const processingTime = Date.now() - startTime;

      this.logger.debug(
        `✅ Embedding gerado em ${processingTime}ms - Dimensões: ${embedding.length}`,
      );

      return embedding;
    } catch (error) {
      this.logger.error('Erro ao gerar embedding:', error);
      throw error;
    }
  }
}

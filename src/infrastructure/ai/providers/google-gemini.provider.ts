import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IAIProvider, TransactionData, UserContext, TransactionType } from '../ai.interface';
import {
  IMAGE_ANALYSIS_SYSTEM_PROMPT,
  IMAGE_ANALYSIS_USER_PROMPT,
} from '../prompts';
import {
  getTransactionSystemPrompt,
  TRANSACTION_USER_PROMPT_TEMPLATE,
} from '../prompts';

/**
 * Google Gemini Provider
 *
 * VANTAGENS:
 * - 80% mais barato que GPT-4 Vision
 * - Multimodal nativo (texto + imagem)
 * - Ótima qualidade para imagens
 * - Rate limits maiores
 *
 * CUSTO:
 * - Gemini 1.5 Pro: $0.00125 / 1K chars (texto)
 * - Gemini 1.5 Pro Vision: $0.0025 / imagem
 * vs
 * - GPT-4 Vision: $0.03 / imagem (12x mais caro!)
 */
@Injectable()
export class GoogleGeminiProvider implements IAIProvider {
  private readonly logger = new Logger(GoogleGeminiProvider.name);
  private apiKey: string;
  private model: string;
  private readonly baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  private initialized = false;

  constructor(private configService: ConfigService) {
    // Inicialização assíncrona será feita no primeiro uso
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
        where: { provider: 'google_gemini' },
      });

      if (providerConfig?.apiKey && providerConfig.enabled) {
        // Usar configuração do banco
        this.apiKey = providerConfig.apiKey;
        this.model = providerConfig.textModel || 'gemini-1.5-flash';
        this.logger.log(`✅ Google Gemini Provider inicializado via BANCO - Modelo: ${this.model}`);
      } else {
        // Fallback para ENV (apenas dev)
        this.apiKey = this.configService.get<string>('ai.google.apiKey', '');
        this.model = this.configService.get<string>('ai.google.model', 'gemini-1.5-flash');

        if (this.apiKey) {
          this.logger.warn('⚠️  Google Gemini usando ENV (configure no banco para produção)');
        } else {
          this.logger.warn('⚠️  Google AI API Key não configurada - Provider desabilitado');
        }
      }

      this.initialized = true;
    } catch (error) {
      this.logger.error('Erro ao inicializar Google Gemini:', error.message);
      this.initialized = true;
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
   * Extrai transação de texto usando Gemini
   */
  async extractTransaction(text: string, userContext?: UserContext): Promise<TransactionData> {
    if (!(await this.isAvailable())) {
      throw new Error('Google Gemini Provider não está disponível (API Key não configurada)');
    }

    try {
      const startTime = Date.now();
      this.logger.debug(`[Gemini] Extraindo transação de: "${text}"`);

      const systemPrompt = getTransactionSystemPrompt();
      const prompt = TRANSACTION_USER_PROMPT_TEMPLATE(text, userContext?.categories);

      const response = await fetch(
        `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${systemPrompt}\n\n${prompt}` }] }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 500,
            },
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.statusText}`);
      }

      const data = await response.json();
      const resultText = data.candidates[0]?.content?.parts[0]?.text || '{}';

      // Extrair JSON do response (pode vir com markdown)
      const jsonMatch = resultText.match(/\{[\s\S]*\}/);
      const result = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(resultText);

      const processingTime = Date.now() - startTime;

      this.logger.log(
        `✅ [Gemini] Transação extraída em ${processingTime}ms - Valor: ${result.amount}`,
      );

      return result;
    } catch (error) {
      this.logger.error('[Gemini] Erro ao extrair transação:', error);
      throw error;
    }
  }

  /**
   * Analisa imagem (NFe, comprovante) com Gemini Vision
   * MUITO MAIS BARATO que GPT-4 Vision!
   */
  async analyzeImage(imageBuffer: Buffer, mimeType: string): Promise<TransactionData> {
    try {
      const startTime = Date.now();
      this.logger.log(
        `[Gemini Vision] Analisando imagem (${(imageBuffer.length / 1024).toFixed(2)} KB)`,
      );

      // Normalizar mimeType para formato aceito pelo Gemini
      let normalizedMimeType = mimeType.toLowerCase();
      
      // Mapear tipos comuns para formatos aceitos pelo Gemini
      const mimeTypeMap: Record<string, string> = {
        'image/jpg': 'image/jpeg',
        'image/jpe': 'image/jpeg',
        'application/pdf': 'application/pdf',
      };
      
      normalizedMimeType = mimeTypeMap[normalizedMimeType] || normalizedMimeType;
      
      // Validar que é um tipo suportado
      const supportedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
      if (!supportedTypes.includes(normalizedMimeType)) {
        throw new Error(`Tipo de imagem não suportado: ${mimeType}. Tipos aceitos: JPG, PNG, WEBP, HEIC, HEIF, PDF`);
      }

      this.logger.log(`[Gemini Vision] MimeType normalizado: ${mimeType} → ${normalizedMimeType}`);

      const base64Image = imageBuffer.toString('base64');

      const prompt = `${IMAGE_ANALYSIS_SYSTEM_PROMPT}\n\n${IMAGE_ANALYSIS_USER_PROMPT}`;

      const response = await fetch(
        `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt },
                  {
                    inline_data: {
                      mime_type: normalizedMimeType,
                      data: base64Image,
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 1000,
            },
          }),
        },
      );

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(`[Gemini] API Error Response: ${errorBody}`);
        throw new Error(`Gemini API error: ${response.statusText}`);
      }

      const data = await response.json();
      const resultText = data.candidates[0]?.content?.parts[0]?.text || '{}';

      // Extrair JSON do response
      const jsonMatch = resultText.match(/\{[\s\S]*\}/);
      const result = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(resultText);

      const processingTime = Date.now() - startTime;

      this.logger.log(
        `✅ [Gemini Vision] Imagem analisada em ${processingTime}ms - Valor: ${result.amount}, Confiança: ${result.confidence}`,
      );

      return result;
    } catch (error) {
      this.logger.error('[Gemini] Erro ao analisar imagem:', error);
      throw error;
    }
  }

  /**
   * Transcreve áudio (Gemini não tem Whisper nativo, usa OpenAI ou Groq)
   */
  async transcribeAudio(_audioBuffer: Buffer, _mimeType: string): Promise<string> {
    throw new Error('Gemini não suporta transcrição de áudio diretamente. Use Groq ou OpenAI.');
  }

  /**
   * Sugere categoria
   */
  async suggestCategory(description: string, userCategories: string[]): Promise<string> {
    try {
      this.logger.debug(`[Gemini] Sugerindo categoria para: "${description}"`);

      let prompt = `Baseado na descrição "${description}", sugira UMA categoria apropriada.`;

      if (userCategories.length > 0) {
        prompt += `\n\nCategorias disponíveis: ${userCategories.join(', ')}`;
        prompt += '\n\nEscolha uma dessas ou sugira uma nova.';
      }

      prompt += '\n\nRetorne APENAS o nome da categoria (sem explicações).';

      const response = await fetch(
        `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 50,
            },
          }),
        },
      );

      const data = await response.json();
      const category = data.candidates[0]?.content?.parts[0]?.text?.trim() || 'Outros';

      this.logger.log(`✅ [Gemini] Categoria sugerida: ${category}`);

      return category;
    } catch (error) {
      this.logger.error('[Gemini] Erro ao sugerir categoria:', error);
      return 'Outros';
    }
  }

  /**
   * Gera embedding vetorial usando text-embedding-004
   * Modelo leve e eficiente do Google
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!(await this.isAvailable())) {
      throw new Error('Google Gemini Provider não está disponível (API Key não configurada)');
    }

    try {
      const startTime = Date.now();
      this.logger.debug(`[Gemini] Gerando embedding para: "${text}"`);

      const response = await fetch(
        `${this.baseUrl}/models/text-embedding-004:embedContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'models/text-embedding-004',
            content: {
              parts: [{ text }],
            },
          }),
        },
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      const embedding = data.embedding?.values || [];
      const processingTime = Date.now() - startTime;

      this.logger.debug(
        `✅ [Gemini] Embedding gerado em ${processingTime}ms - Dimensões: ${embedding.length}`,
      );

      return embedding;
    } catch (error) {
      this.logger.error('[Gemini] Erro ao gerar embedding:', error);
      throw error;
    }
  }
}

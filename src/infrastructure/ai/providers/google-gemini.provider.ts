import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IAIProvider, TransactionData, UserContext } from '../ai.interface';
import {
  IMAGE_ANALYSIS_SYSTEM_PROMPT,
  IMAGE_ANALYSIS_USER_PROMPT,
} from '../../../features/transactions/contexts/registration/prompts/image-analysis.prompt';

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
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl = 'https://generativelanguage.googleapis.com/v1beta';

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('ai.google.apiKey', '');
    this.model = this.configService.get<string>('ai.google.model', 'gemini-1.5-pro');

    if (!this.apiKey) {
      this.logger.warn('⚠️  Google AI API Key não configurada - Provider desabilitado');
    } else {
      this.logger.log(`✅ Google Gemini Provider inicializado - Modelo: ${this.model}`);
    }
  }

  /**
   * Verifica se o provider está disponível
   */
  private isAvailable(): boolean {
    return !!this.apiKey;
  }

  /**
   * Extrai transação de texto usando Gemini
   */
  async extractTransaction(text: string, userContext?: UserContext): Promise<TransactionData> {
    if (!this.isAvailable()) {
      throw new Error('Google Gemini Provider não está disponível (API Key não configurada)');
    }

    try {
      const startTime = Date.now();
      this.logger.debug(`[Gemini] Extraindo transação de: "${text}"`);

      const prompt = this.buildTransactionPrompt(text, userContext?.categories);

      const response = await fetch(
        `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
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
                      mime_type: mimeType,
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
   * Constrói prompt de transação
   */
  private buildTransactionPrompt(text: string, userCategories?: string[]): string {
    let prompt = `Extraia dados de transação financeira da seguinte mensagem: "${text}"`;

    if (userCategories && userCategories.length > 0) {
      prompt += `\n\nCategorias do usuário: ${userCategories.join(', ')}`;
    }

    prompt += `\n\nRetorne um objeto JSON com:
{
  "type": "EXPENSES" ou "INCOME",
  "amount": número,
  "category": "string",
  "description": "string ou null",
  "date": "ISO 8601 ou null",
  "merchant": "string ou null",
  "confidence": número entre 0 e 1
}`;

    return prompt;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IAIProvider,
  TransactionData,
  TransactionType,
  UserContext,
  AIProviderType,
} from '../ai.interface';

/**
 * Groq Provider - Especializado em ÁUDIO
 *
 * VANTAGENS GROQ:
 * - Whisper GRÁTIS e ilimitado! 🎉
 * - Latência ultra-baixa (5-10x mais rápido que OpenAI)
 * - Modelos open-source (Llama 3, Mixtral)
 * - Ótimo para produção com alto volume
 *
 * CUSTO:
 * - Whisper (áudio): GRÁTIS! 🆓
 * - Llama 3 70B: $0.00059 / 1K tokens (input), $0.00079 (output)
 * - Mixtral 8x7B: $0.00024 / 1K tokens (input), $0.00024 (output)
 *
 * vs OpenAI:
 * - Whisper OpenAI: $0.006 / minuto
 * - GPT-4: $0.03 / 1K tokens
 */
@Injectable()
export class GroqProvider implements IAIProvider {
  private readonly logger = new Logger(GroqProvider.name);
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl = 'https://api.groq.com/openai/v1';

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('ai.groq.apiKey', '');
    this.model = this.configService.get<string>('ai.groq.model', 'llama-3.1-70b-versatile');

    if (!this.apiKey) {
      this.logger.warn('⚠️  Groq API Key não configurada - Provider desabilitado');
    } else {
      this.logger.log(`✅ Groq Provider inicializado - Modelo: ${this.model}`);
      this.logger.log(`🎤 Whisper GRÁTIS disponível!`);
    }
  }

  /**
   * Verifica se o provider está disponível
   */
  private isAvailable(): boolean {
    return !!this.apiKey;
  }

  /**
   * Extrai transação de texto usando Llama 3 ou Mixtral
   */
  async extractTransaction(text: string, userContext?: UserContext): Promise<TransactionData> {
    if (!this.isAvailable()) {
      throw new Error('Groq Provider não está disponível (API Key não configurada)');
    }

    try {
      const startTime = Date.now();
      this.logger.debug(`[Groq] Extraindo transação de: "${text}"`);

      const prompt = this.buildTransactionPrompt(text, userContext?.categories);

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content:
                'Você é um assistente que extrai dados de transações financeiras. Sempre responda em JSON válido.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
          max_tokens: 500,
        }),
      });

      if (!response.ok) {
        throw new Error(`Groq API error: ${response.statusText}`);
      }

      const data = await response.json();
      const resultText = data.choices[0]?.message?.content || '{}';

      // Extrair JSON
      const jsonMatch = resultText.match(/\{[\s\S]*\}/);
      const result = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(resultText);

      const processingTime = Date.now() - startTime;

      this.logger.log(
        `✅ [Groq] Transação extraída em ${processingTime}ms ⚡ - Valor: ${result.amount}`,
      );

      return result;
    } catch (error) {
      this.logger.error('[Groq] Erro ao extrair transação:', error);
      throw error;
    }
  }

  /**
   * Analisa imagem (Groq não tem vision nativo, use Gemini ou OpenAI)
   */
  async analyzeImage(imageBuffer: Buffer, mimeType: string): Promise<TransactionData> {
    throw new Error('Groq não suporta análise de imagem. Use Google Gemini ou OpenAI Vision.');
  }

  /**
   * Transcreve áudio usando Whisper GRÁTIS no Groq! 🎉
   * MUITO MAIS RÁPIDO que OpenAI e SEM CUSTO!
   */
  async transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<string> {
    try {
      const startTime = Date.now();
      this.logger.log(
        `[Groq Whisper] Transcrevendo áudio GRÁTIS (${(audioBuffer.length / 1024).toFixed(2)} KB)`,
      );

      // Groq usa a mesma API que OpenAI para Whisper
      const formData = new FormData();
      const audioBlob = new Blob([audioBuffer as any], { type: mimeType });
      formData.append('file', audioBlob, 'audio.mp3');
      formData.append('model', 'whisper-large-v3');
      formData.append('language', 'pt');
      formData.append('response_format', 'text');

      const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Groq Whisper API error: ${response.statusText} - ${errorText}`);
      }

      const transcription = await response.text();
      const processingTime = Date.now() - startTime;

      this.logger.log(`✅ [Groq Whisper] Áudio transcrito em ${processingTime}ms ⚡ GRÁTIS! 🆓`);

      return transcription.trim();
    } catch (error) {
      this.logger.error('[Groq Whisper] Erro ao transcrever áudio:', error);
      throw error;
    }
  }

  /**
   * Sugere categoria
   */
  async suggestCategory(description: string, userCategories: string[]): Promise<string> {
    try {
      this.logger.debug(`[Groq] Sugerindo categoria para: "${description}"`);

      let prompt = `Baseado na descrição "${description}", sugira UMA categoria de gasto.`;

      if (userCategories.length > 0) {
        prompt += `\n\nCategorias disponíveis: ${userCategories.join(', ')}`;
      }

      prompt += '\n\nRetorne APENAS o nome da categoria.';

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
          max_tokens: 50,
        }),
      });

      const data = await response.json();
      const category = data.choices[0]?.message?.content?.trim() || 'Outros';

      this.logger.log(`✅ [Groq] Categoria sugerida: ${category}`);

      return category;
    } catch (error) {
      this.logger.error('[Groq] Erro ao sugerir categoria:', error);
      return 'Outros';
    }
  }

  /**
   * Constrói prompt de transação
   */
  private buildTransactionPrompt(text: string, userCategories?: string[]): string {
    let prompt = `Extraia dados de transação da mensagem: "${text}"`;

    if (userCategories && userCategories.length > 0) {
      prompt += `\n\nCategorias: ${userCategories.join(', ')}`;
    }

    prompt += `\n\nJSON:
{
  "type": "EXPENSES" ou "INCOME",
  "amount": número,
  "category": "string",
  "description": "string ou null",
  "date": "ISO 8601 ou null",
  "merchant": "string ou null",
  "confidence": 0-1
}`;

    return prompt;
  }
}

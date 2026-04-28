import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// @ts-ignore - groq-sdk não instalado ainda
import Groq from 'groq-sdk';
import { CryptoService } from '../../../common/services/crypto.service';
import { PrismaService } from '../../../core/database/prisma.service';
import {
  IAIProvider,
  TransactionData,
  TransactionType,
  UserContext,
  AIProviderType,
} from '../ai.interface';
import { aiCredentialContext } from '../credentials/ai-credential.context';
import { getTransactionSystemPrompt, TRANSACTION_USER_PROMPT_TEMPLATE } from '../prompts';

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
  private model: string = 'llama-3.1-70b-versatile';
  private readonly baseUrl = 'https://api.groq.com/openai/v1';
  private modelsLoaded = false;

  constructor(
    private configService: ConfigService,
    private cryptoService: CryptoService,
    private prismaService: PrismaService,
  ) {}

  /**
   * 🆕 [AI3] Carrega APENAS modelo do banco. ApiKey vem do contexto.
   */
  private async loadModels(): Promise<void> {
    if (this.modelsLoaded) return;
    try {
      const cfg = await this.prismaService.aIProviderConfig.findUnique({
        where: { provider: 'groq' },
      });
      if (cfg?.textModel) this.model = cfg.textModel;
    } catch (err) {
      this.logger.warn(`Groq: falha ao carregar modelo: ${(err as Error).message}`);
    }
    this.modelsLoaded = true;
  }

  private getActiveApiKey(): string {
    const cred = aiCredentialContext.getStore();
    if (!cred) {
      throw new Error('GroqProvider chamado sem credencial no contexto.');
    }
    return cred.apiKey;
  }

  /**
   * Verifica se o provider está disponível
   */
  private async isAvailable(): Promise<boolean> {
    await this.loadModels();
    return !!aiCredentialContext.getStore();
  }

  /**
   * Extrai transação de texto usando Llama 3 ou Mixtral
   */
  async extractTransaction(text: string, userContext?: UserContext): Promise<TransactionData> {
    if (!(await this.isAvailable())) {
      throw new Error('Groq Provider não está disponível (API Key não configurada)');
    }

    try {
      const startTime = Date.now();
      this.logger.debug(`[Groq] Extraindo transação de: "${text}"`);

      const prompt = TRANSACTION_USER_PROMPT_TEMPLATE(text, userContext?.categories);

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.getActiveApiKey()}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: getTransactionSystemPrompt(), // Gera prompt com data atual
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
          max_tokens: 500,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`[Groq] Erro HTTP ${response.status}: ${errorText}`);
        throw new Error(`Groq API error: ${response.statusText} - ${errorText}`);
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
          Authorization: `Bearer ${this.getActiveApiKey()}`,
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
          Authorization: `Bearer ${this.getActiveApiKey()}`,
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
   * Gera embedding vetorial
   * Groq não suporta embeddings nativamente, usa fallback para OpenAI
   */
  async generateEmbedding(text: string): Promise<number[]> {
    throw new Error(
      'Groq não suporta embeddings. Use OpenAI ou Google Gemini para RAG com embeddings.',
    );
  }
}

import { AIProviderType } from './ai.interface';

/**
 * Configuração de fallback entre providers
 *
 * Define ordem de tentativas caso um provider falhe ou atinja rate limit
 *
 * IMPORTANTE:
 * - Se não configurado, NÃO faz fallback (retorna erro)
 * - Configure via código ou ENV para habilitar
 */

export interface FallbackChain {
  enabled: boolean;
  chains: {
    text: AIProviderType[];
    image: AIProviderType[];
    audio: AIProviderType[];
    category: AIProviderType[];
  };
  minConfidence: number; // Confidence mínima para aceitar resultado
}

/**
 * Configuração padrão de fallback (DESABILITADO por padrão)
 */
export const DEFAULT_FALLBACK_CONFIG: FallbackChain = {
  enabled: false, // IMPORTANTE: Desabilitado por padrão
  chains: {
    text: [],
    image: [],
    audio: [],
    category: [],
  },
  minConfidence: 0.7,
};

/**
 * Exemplo de configuração com fallback habilitado
 *
 * Use essa configuração se quiser fallback automático:
 */
export const FALLBACK_ENABLED_EXAMPLE: FallbackChain = {
  enabled: true,
  chains: {
    // Texto: OpenAI → Groq → Gemini
    text: [AIProviderType.OPENAI, AIProviderType.GROQ, AIProviderType.GOOGLE_GEMINI],

    // Imagem: Gemini → OpenAI (Groq não tem vision)
    image: [AIProviderType.GOOGLE_GEMINI, AIProviderType.OPENAI],

    // Áudio: Groq (grátis) → OpenAI (pago)
    audio: [AIProviderType.GROQ, AIProviderType.OPENAI],

    // Categoria: Groq → OpenAI → Gemini
    category: [AIProviderType.GROQ, AIProviderType.OPENAI, AIProviderType.GOOGLE_GEMINI],
  },
  minConfidence: 0.7,
};

/**
 * Carrega configuração de fallback do ambiente
 */
export function loadFallbackConfig(): FallbackChain {
  // Verifica se fallback está habilitado via ENV
  const enabled = process.env.AI_FALLBACK_ENABLED === 'true';

  if (!enabled) {
    return DEFAULT_FALLBACK_CONFIG;
  }

  // Carregar chains customizadas do ENV (opcional)
  const textChain = (process.env.AI_FALLBACK_TEXT_CHAIN?.split(',') as AIProviderType[]) || [];
  const imageChain = (process.env.AI_FALLBACK_IMAGE_CHAIN?.split(',') as AIProviderType[]) || [];
  const audioChain = (process.env.AI_FALLBACK_AUDIO_CHAIN?.split(',') as AIProviderType[]) || [];
  const categoryChain =
    (process.env.AI_FALLBACK_CATEGORY_CHAIN?.split(',') as AIProviderType[]) || [];

  const minConfidence = parseFloat(process.env.AI_FALLBACK_MIN_CONFIDENCE || '0.7');

  return {
    enabled: true,
    chains: {
      text: textChain.length > 0 ? textChain : FALLBACK_ENABLED_EXAMPLE.chains.text,
      image: imageChain.length > 0 ? imageChain : FALLBACK_ENABLED_EXAMPLE.chains.image,
      audio: audioChain.length > 0 ? audioChain : FALLBACK_ENABLED_EXAMPLE.chains.audio,
      category: categoryChain.length > 0 ? categoryChain : FALLBACK_ENABLED_EXAMPLE.chains.category,
    },
    minConfidence,
  };
}

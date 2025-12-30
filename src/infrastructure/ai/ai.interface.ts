/**
 * Interface genérica para provedores de IA
 * Permite trocar facilmente entre OpenAI, Google, Anthropic, Groq, etc.
 */

export interface IAIProvider {
  /**
   * Extrai dados de transação a partir de texto
   */
  extractTransaction(text: string, userContext?: UserContext): Promise<TransactionData>;

  /**
   * Analisa imagem (NFe, comprovante) e extrai dados
   */
  analyzeImage(imageBuffer: Buffer, mimeType: string): Promise<TransactionData>;

  /**
   * Transcreve áudio para texto
   */
  transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<string>;

  /**
   * Sugere categoria baseada na descrição
   */
  suggestCategory(description: string, userCategories: string[]): Promise<string>;

  /**
   * Gera embedding vetorial de um texto
   * Usado para busca semântica (RAG com embeddings)
   * @returns Array de números representando o vetor do texto
   */
  generateEmbedding(text: string): Promise<number[]>;
}

/**
 * Resposta genérica de IA com metadados de uso (para logging)
 * Nota: Mantida para referência, mas providers ainda retornam os tipos originais
 */
export interface AIResponse<T> {
  data: T; // Dados retornados
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  model: string; // Modelo usado
  responseTime: number; // Tempo de resposta em ms
}

/**
 * Dados extraídos de uma transação
 */
export interface TransactionData {
  type: TransactionType;
  amount: number;
  category: string;
  subCategory?: string; // Subcategoria opcional
  description?: string;
  date?: Date;
  merchant?: string;
  confidence: number; // 0-1
  rawData?: any; // Dados brutos da IA
  temporalInfo?: {
    profile: string;
    confidence: number;
    specificDay?: number;
  };
  
  // 📦 Campos para transações avançadas (fixas, parceladas, cartão)
  isFixed?: boolean;
  fixedFrequency?: 'MONTHLY' | 'WEEKLY' | 'ANNUAL' | 'BIENNIAL';
  installments?: number;
  installmentNumber?: number;
  creditCardId?: string;
  paymentStatus?: 'PENDING' | 'DONE';
  invoiceMonth?: string; // Mês da fatura (YYYY-MM)
}

/**
 * Tipo de transação
 */
export enum TransactionType {
  EXPENSES = 'EXPENSES',
  INCOME = 'INCOME',
}

/**
 * Categoria com subcategorias (para contexto de IA)
 */
export interface CategoryWithSubs {
  id: string;
  name: string;
  subCategories?: Array<{
    id: string;
    name: string;
  }>;
}

/**
 * Contexto do usuário para melhorar extração
 */
export interface UserContext {
  name: string;
  email: string;
  categories: CategoryWithSubs[]; // Mudado de string[] para estrutura completa
  timezone?: string;
  recentTransactions?: RecentTransaction[];
}

/**
 * Transação recente para contexto
 */
export interface RecentTransaction {
  category: string;
  description: string;
  amount?: number;
}

/**
 * Configuração de AI Provider
 */
export interface AIProviderConfig {
  provider: AIProviderType;
  apiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}

/**
 * Tipos de provedores suportados
 */
export enum AIProviderType {
  OPENAI = 'openai',
  GOOGLE_GEMINI = 'google_gemini',
  ANTHROPIC = 'anthropic',
  GROQ = 'groq',
  DEEPSEEK = 'deepseek',
}

/**
 * Configuração de mix-and-match de provedores
 * Permite usar diferentes IAs para diferentes tarefas
 */
export interface AIProviderStrategy {
  text: AIProviderType; // Extração de texto
  image: AIProviderType; // Análise de imagens
  audio: AIProviderType; // Transcrição de áudio
  category: AIProviderType; // Sugestão de categorias
}

/**
 * Resultado de processamento com metadados
 */
export interface AIProcessingResult<T> {
  data: T;
  provider: AIProviderType;
  model: string;
  tokensUsed?: number;
  processingTimeMs: number;
  cost?: number; // Custo estimado em USD
}

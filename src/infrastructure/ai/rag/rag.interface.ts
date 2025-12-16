/**
 * Interface para o serviço RAG (Retrieval-Augmented Generation)
 * Permite matching semântico de categorias sem usar embeddings vetoriais
 */

export interface CategoryMatch {
  categoryId: string;
  categoryName: string;
  subCategoryId?: string;
  subCategoryName?: string;
  score: number; // 0-1 similaridade
  matchedTerms: string[]; // Termos que causaram o match
}

export interface RAGConfig {
  minScore: number; // Score mínimo para considerar match (padrão: 0.6)
  maxResults: number; // Máximo de resultados (padrão: 3)
  boostExactMatch: number; // Boost para match exato (padrão: 2.0)
  boostStartsWith: number; // Boost para começa com (padrão: 1.5)
}

export interface UserCategory {
  id: string;
  name: string;
  accountId: string;
  type?: 'INCOME' | 'EXPENSES';
  subCategory?: {
    id: string;
    name: string;
  };
  // Embedding vetorial (se ragAiEnabled = true)
  embedding?: number[];
}

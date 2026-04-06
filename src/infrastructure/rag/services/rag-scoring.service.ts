import { Injectable } from '@nestjs/common';
import { UserCategory } from './rag.interface';
import { SYNONYM_ENTRIES } from '../data/synonym-entries';
import { TextProcessingService } from './text-processing.service';

/**
 * Helper: constrói Map de sinônimos mesclando entradas duplicadas.
 */
function buildMergedSynonymMap(entries: [string, string[]][]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [key, values] of entries) {
    const existing = map.get(key);
    map.set(key, existing ? [...new Set([...existing, ...values])] : [...new Set(values)]);
  }
  return map;
}

/**
 * RagScoringService
 *
 * Responsabilidade única: algoritmos de scoring BM25 e matching de sinônimos/bigrams.
 * Não tem dependências de I/O (sem Prisma, sem Redis, sem AI).
 * Todos os métodos são determinísticos e testáveis de forma isolada.
 *
 * ALGORITMOS:
 * - BM25 com IDF real e normalização de comprimento de documento
 * - Sinônimos estáticos (SYNONYM_ENTRIES) com deduplicação de pares bidirecionais
 * - Bigrams: boost para termos compostos ("material escolar", "cartão crédito")
 * - Cosine similarity para busca vetorial
 */
@Injectable()
export class RagScoringService {
  private readonly synonyms = buildMergedSynonymMap(SYNONYM_ENTRIES);

  // Cache em memória para doc-frequency maps (evita recalcular a cada busca)
  private readonly docFreqCache = new Map<
    string,
    { totalDocs: number; docFreqMap: Map<string, number>; avgDocLength: number; timestamp: number }
  >();
  private readonly DOC_FREQ_CACHE_TTL = 5 * 60_000; // 5 min

  constructor(private readonly textProcessing: TextProcessingService) {}

  // ─────────────────────────────── BM25 ────────────────────────────────────

  /**
   * Calcula score BM25 com IDF real e comprimento de documento dinâmico.
   *
   * BM25 = Σ IDF(t) * TF_saturated(t, d)
   * k1=1.2 (saturação TF), b=0.75 (normalização comprimento)
   */
  calculateBM25Score(
    queryTokens: string[],
    docTokens: string[],
    totalDocs?: number,
    docFreqMap?: Map<string, number>,
    avgDocLength: number = 3,
  ): number {
    let score = 0;
    const docLength = docTokens.length;
    const k1 = 1.2;
    const b = 0.75;

    for (const queryToken of queryTokens) {
      const tf = docTokens.filter((t) => t === queryToken).length;
      if (tf === 0) continue;

      let idf = 1.0;
      if (totalDocs && docFreqMap) {
        const df = docFreqMap.get(queryToken) || 0;
        idf = Math.max(Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1), 0.1);
      }

      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + b * (docLength / avgDocLength));
      score += idf * (numerator / denominator);
    }

    return score;
  }

  /**
   * Pré-computa frequência de documentos para IDF real.
   * Resultado é cacheado em memória por cacheKey (accountId:type).
   */
  precomputeDocFrequencies(
    categories: UserCategory[],
    cacheKey?: string,
  ): { totalDocs: number; docFreqMap: Map<string, number>; avgDocLength: number } {
    if (cacheKey) {
      const cached = this.docFreqCache.get(cacheKey);
      if (
        cached &&
        Date.now() - cached.timestamp < this.DOC_FREQ_CACHE_TTL &&
        cached.totalDocs === categories.length
      ) {
        return cached;
      }
    }

    const docFreqMap = new Map<string, number>();
    const totalDocs = categories.length;
    let totalTokenCount = 0;

    for (const cat of categories) {
      const catText = `${cat.name} ${cat.subCategory?.name || ''}`;
      const tokens = this.textProcessing.tokenize(this.textProcessing.normalize(catText));
      totalTokenCount += tokens.length;
      for (const token of new Set(tokens)) {
        docFreqMap.set(token, (docFreqMap.get(token) || 0) + 1);
      }
    }

    const result = {
      totalDocs,
      docFreqMap,
      avgDocLength: totalDocs > 0 ? totalTokenCount / totalDocs : 3,
      timestamp: Date.now(),
    };

    if (cacheKey) this.docFreqCache.set(cacheKey, result);
    return result;
  }

  // ─────────────────────────────── Sinônimos ───────────────────────────────

  /**
   * Conta matches de sinônimos entre tokens da query e do documento.
   *
   * FIX: usa pares canônicos para evitar dupla contagem de relações bidirecio-
   * nais (quando 'restaurante→comida' E 'comida→restaurante' existem no dicio-
   * nário, o par é contado apenas uma vez).
   */
  checkSynonyms(queryTokens: string[], docTokens: string[]): number {
    const seen = new Set<string>();
    let synonymMatches = 0;

    for (const queryToken of queryTokens) {
      for (const docToken of docTokens) {
        // Par canônico: ordem alfabética garante unicidade bidirecional
        const pair = [queryToken, docToken].sort().join('::');
        if (seen.has(pair)) continue;

        const isMatch =
          (this.synonyms.get(queryToken) || []).includes(docToken) ||
          (this.synonyms.get(docToken) || []).includes(queryToken);

        if (isMatch) {
          seen.add(pair);
          synonymMatches++;
        }
      }
    }

    return synonymMatches;
  }

  /**
   * Lista os termos que causaram match (para debug/analytics).
   */
  findMatchedTerms(queryTokens: string[], docTokens: string[]): string[] {
    const matched: string[] = [];
    const seen = new Set<string>();

    for (const queryToken of queryTokens) {
      if (docTokens.includes(queryToken)) {
        matched.push(queryToken);
      }
      const synonyms = this.synonyms.get(queryToken) || [];
      for (const docToken of docTokens) {
        if (synonyms.includes(docToken)) {
          const key = `${queryToken}→${docToken}`;
          if (!seen.has(key)) {
            seen.add(key);
            matched.push(key);
          }
        }
      }
    }

    return matched;
  }

  // ─────────────────────────────── Bigrams ─────────────────────────────────

  /**
   * Gera bigrams de uma sequência de tokens.
   * Ex: ["cartao", "credito"] → ["cartao_credito"]
   * Ex: ["material", "escolar"] → ["material_escolar"]
   */
  buildBigrams(tokens: string[]): string[] {
    const bigrams: string[] = [];
    for (let i = 0; i < tokens.length - 1; i++) {
      bigrams.push(`${tokens[i]}_${tokens[i + 1]}`);
    }
    return bigrams;
  }

  /**
   * Conta matches de bigrams entre query e documento.
   * Útil para termos compostos: "material escolar", "cartão crédito",
   * "energia elétrica", etc.
   */
  checkBigramMatches(queryTokens: string[], docTokens: string[]): number {
    const queryBigrams = this.buildBigrams(queryTokens);
    const docBigrams = new Set(this.buildBigrams(docTokens));
    if (queryBigrams.length === 0 || docBigrams.size === 0) return 0;
    return queryBigrams.filter((bg) => docBigrams.has(bg)).length;
  }

  // ──────────────────────────── Vetorial ───────────────────────────────────

  /**
   * Similaridade de cosseno entre dois vetores de embedding.
   * Retorna valor entre 0 (ortogonal) e 1 (idêntico).
   */
  cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error(`Vetores com dimensões diferentes: ${vecA.length} vs ${vecB.length}`);
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }
}

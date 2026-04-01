/**
 * Utilitários de string compartilhados.
 * Inclui normalização para NLP e cálculo de similaridade (Levenshtein).
 */

/**
 * Normaliza texto para análise de intenção:
 * - lowercase
 * - remove diacríticos (acentos)
 * - remove caracteres especiais (~, pontuação)
 * - colapsa espaços múltiplos
 *
 * Ex: "transaç~eos" → "transacoes"
 *     "Gastei R$ 50,00 no mercado!" → "gastei r$ 50,00 no mercado"
 */
export function normalizeForIntent(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove acentos
    .replace(/~/g, '') // Remove til solto
    .replace(/[^\w\s$,.:/\-]/g, '') // Remove pontuação (mantém $ , . : / - para valores)
    .replace(/\s+/g, ' ') // Colapsa espaços múltiplos
    .trim();
}

/**
 * Normaliza texto de forma agressiva (para comparação de keywords):
 * Remove TUDO exceto letras e espaços.
 *
 * Ex: "transações..." → "transacoes"
 */
export function normalizeKeyword(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calcula a distância de Levenshtein entre duas strings.
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

/**
 * Calcula similaridade entre duas strings (0-1).
 * 1 = idênticas, 0 = completamente diferentes.
 */
export function stringSimilarity(str1: string, str2: string): number {
  const longer = str1.length >= str2.length ? str1 : str2;
  const shorter = str1.length >= str2.length ? str2 : str1;

  if (longer.length === 0) return 1.0;

  const distance = levenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
}

/**
 * Verifica se alguma keyword faz fuzzy-match com o texto.
 * Retorna a keyword que deu match ou null.
 *
 * @param text - Texto do usuário (já normalizado)
 * @param keywords - Lista de keywords para comparar
 * @param minSimilarity - Similaridade mínima (default: 0.75)
 */
export function fuzzyMatchKeyword(
  text: string,
  keywords: readonly string[],
  minSimilarity = 0.75,
): string | null {
  // Só aplica fuzzy em textos curtos (≤ 3 palavras) para evitar false positives
  const words = text.split(' ');
  if (words.length > 3) return null;

  let bestMatch: string | null = null;
  let bestScore = 0;

  for (const keyword of keywords) {
    // Normaliza keyword também
    const normalizedKeyword = normalizeKeyword(keyword);

    // Tenta match do texto inteiro contra o keyword
    const similarity = stringSimilarity(text, normalizedKeyword);
    if (similarity >= minSimilarity && similarity > bestScore) {
      bestScore = similarity;
      bestMatch = keyword;
    }

    // Tenta match de cada palavra do texto contra keywords de uma palavra
    if (normalizedKeyword.split(' ').length === 1) {
      for (const word of words) {
        const wordSim = stringSimilarity(word, normalizedKeyword);
        if (wordSim >= minSimilarity && wordSim > bestScore) {
          bestScore = wordSim;
          bestMatch = keyword;
        }
      }
    }
  }

  return bestMatch;
}

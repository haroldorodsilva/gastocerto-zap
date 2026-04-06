import { Injectable } from '@nestjs/common';
import { FILTER_WORDS_FOR_TERM_DETECTION } from '@common/constants/nlp-keywords.constants';
import { UserCategory } from './rag.interface';

/**
 * TextProcessingService
 *
 * Responsabilidades de processamento de texto extraídas do RAGService:
 * - Normalização (lowercase, remoção de acentos)
 * - Tokenização (split + normalização de plurais pt-BR)
 * - Extração do termo principal de uma query
 *
 * Não possui dependências externas (PrismaService, Cache, etc.)
 * — todas as operações são side-effect free.
 */
@Injectable()
export class TextProcessingService {
  /**
   * Normaliza texto: lowercase, remove acentos, trim
   */
  normalize(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove acentos
      .replace(/[^\w\s]/g, ' ') // Remove pontuação
      .trim();
  }

  /**
   * Tokeniza texto em palavras.
   * Normaliza plurais para singular com lista expandida de exceções (pt-BR).
   */
  tokenize(text: string): string[] {
    const tokens = text.split(/\s+/).filter((token) => token.length > 2); // Ignora tokens muito curtos

    // Palavras que terminam em 's' mas NÃO devem perder o 's'
    const keepAsIs = new Set([
      'gas',
      'mas',
      'tras',
      'pais',
      'deus',
      'meus',
      'seus',
      'teus',
      'nos',
      'vos',
      'tres',
      'mes',
      'reis',
      'leis',
      'vez',
      'bus',
      'jus',
      'pus',
      'plus',
      'bonus',
      'virus',
      'atlas',
      'onibus',
      'cris',
      'paris',
      'ais',
      'eis',
      'ois',
      'uis',
      'juros',
      'alias',
      'campus',
      'corpus',
      'status',
      'pires',
      'lapis',
      'gratis',
      'oasis',
      'chassis',
      'herpes',
      'caries',
    ]);

    // Normalizar plurais simples para melhorar matching
    return tokens.map((token) => {
      // Não remover 's' de palavras na lista de exceções
      if (keepAsIs.has(token)) {
        return token;
      }

      // Plurais em 'ões' → 'ao' (ex: transações → transacao)
      if (token.endsWith('oes') && token.length > 5) {
        return token.slice(0, -3) + 'ao';
      }

      // Plurais em 'ais' → 'al' (ex: materiais → material)
      if (token.endsWith('ais') && token.length > 5) {
        return token.slice(0, -3) + 'al';
      }

      // Plurais em 'eis' → 'el' (ex: moveis → movel)
      if (token.endsWith('eis') && token.length > 5) {
        return token.slice(0, -3) + 'el';
      }

      // Remove plural simples: "financiamentos" → "financiamento"
      if (token.endsWith('s') && token.length > 4) {
        return token.slice(0, -1);
      }

      return token;
    });
  }

  /**
   * Extrai o termo principal de um texto bruto (API pública).
   * Usado pelo RAGLearningService para manter lógica unificada.
   */
  extractMainTermFromText(text: string): string | null {
    const normalized = this.normalize(text);
    const tokens = this.tokenize(normalized);
    // Sem categorias disponíveis, usa apenas heurística de stopwords/genéricos
    return this.extractMainTerm(tokens, []);
  }

  /**
   * Extrai o termo principal da query (palavra mais significativa).
   * Ignora stopwords e tokens muito genéricos.
   *
   * @param tokens Tokens já normalizados/tokenizados
   * @param categories Categorias do usuário (para priorizar termos desconhecidos)
   */
  extractMainTerm(tokens: string[], categories: UserCategory[]): string | null {
    // Stopwords comuns em português (expandir conforme necessário)
    const stopwords = new Set([
      'com',
      'para',
      'gastei',
      'paguei',
      'comprei',
      'fui',
      'uma',
      'uns',
      'umas',
      'na',
      'no',
      'da',
      'do',
      'em',
      'ao',
      'pelo',
      'pela',
      'reais',
      'real',
    ]);

    // 🔥 Palavras muito genéricas que devem ser ignoradas
    const genericWords = new Set([
      'outro',
      'outra',
      'outros',
      'outras',
      'coisa',
      'coisas',
      'negocio',
      'negócio',
      'item',
      'produto',
    ]);

    // Buscar tokens que não são stopwords nem genéricos
    const significantTokens = tokens.filter(
      (token) => !stopwords.has(token) && !genericWords.has(token),
    );

    if (significantTokens.length === 0) {
      return null;
    }

    // 🎯 NOVA LÓGICA: Dar prioridade a termos mais específicos
    // 1. Ordenar por tamanho (termos mais longos tendem a ser mais específicos)
    // 2. Filtrar termos que NÃO são subcategorias conhecidas
    const tokensWithScore = significantTokens.map((token) => {
      const isKnownSubcategory = categories.some((cat) => {
        if (!cat.subCategory?.name) return false;
        const normalizedSub = this.normalize(cat.subCategory.name);
        return normalizedSub.includes(token) || token.includes(normalizedSub);
      });

      return {
        token,
        length: token.length,
        isKnownSubcategory,
      };
    });

    // Priorizar termos DESCONHECIDOS e mais longos
    const unknownTokens = tokensWithScore.filter((t) => !t.isKnownSubcategory);

    if (unknownTokens.length > 0) {
      // Ordenar por tamanho (maior primeiro)
      unknownTokens.sort((a, b) => b.length - a.length);
      return unknownTokens[0].token;
    }

    // Se todos são conhecidos, retornar o mais longo
    tokensWithScore.sort((a, b) => b.length - a.length);
    return tokensWithScore[0].token;
  }

  /**
   * Filtra tokens removendo palavras temporais, verbos de transação e números.
   * Útil antes de chamar `extractMainTerm()`.
   */
  filterTokensForTermDetection(tokens: string[]): string[] {
    return tokens.filter((t) => !FILTER_WORDS_FOR_TERM_DETECTION.includes(t) && !/^\d+$/.test(t));
  }

  /**
   * Gera bigrams de uma sequência de tokens.
   * Útil para matching de termos compostos: "material escolar", "energia elétrica".
   *
   * @example
   * buildBigrams(['cartao', 'credito']) → ['cartao_credito']
   * buildBigrams(['material', 'escolar']) → ['material_escolar']
   */
  buildBigrams(tokens: string[]): string[] {
    const bigrams: string[] = [];
    for (let i = 0; i < tokens.length - 1; i++) {
      bigrams.push(`${tokens[i]}_${tokens[i + 1]}`);
    }
    return bigrams;
  }
}

/**
 * Utilitário para sanitizar e limpar mensagens de texto
 */
export class MessageSanitizerUtil {
  /**
   * Remove espaços extras, quebras de linha múltiplas e caracteres especiais desnecessários
   * @param text - Texto a ser sanitizado
   * @returns Texto limpo
   */
  static sanitize(text: string): string {
    if (!text) return '';

    return text
      .trim() // Remove espaços no início e fim
      .replace(/\s+/g, ' ') // Substitui múltiplos espaços por um único
      .replace(/\n{3,}/g, '\n\n'); // Substitui múltiplas quebras de linha por no máximo 2
  }

  /**
   * Remove emojis do texto
   * @param text - Texto original
   * @returns Texto sem emojis
   */
  static removeEmojis(text: string): string {
    if (!text) return '';

    return text.replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
      '',
    );
  }

  /**
   * Extrai apenas números de um texto
   * @param text - Texto original
   * @returns Apenas os números encontrados
   *
   * @example
   * extractNumbers("Gastei R$ 150,50") // "15050"
   * extractNumbers("Total: 1.500,00")  // "150000"
   */
  static extractNumbers(text: string): string {
    if (!text) return '';
    return text.replace(/\D/g, '');
  }

  /**
   * Extrai valores monetários de um texto
   * @param text - Texto original
   * @returns Array de valores encontrados em formato numérico
   *
   * @example
   * extractMoneyValues("Gastei R$ 150,50") // [150.50]
   * extractMoneyValues("Total: R$1.500,00 e R$200,00") // [1500.00, 200.00]
   */
  static extractMoneyValues(text: string): number[] {
    if (!text) return [];

    // Padrões para valores monetários brasileiros
    const patterns = [
      /R\$\s?(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/g, // R$ 1.500,00
      /(\d{1,3}(?:\.\d{3})*(?:,\d{2}))/g, // 1.500,00
    ];

    const values: number[] = [];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const valueStr = match[1]
          .replace(/\./g, '') // Remove separadores de milhar
          .replace(',', '.'); // Substitui vírgula por ponto

        const value = parseFloat(valueStr);
        if (!isNaN(value) && !values.includes(value)) {
          values.push(value);
        }
      }
    }

    return values;
  }

  /**
   * Normaliza texto para comparação (lowercase, sem acentos, sem espaços extras)
   * @param text - Texto original
   * @returns Texto normalizado
   */
  static normalize(text: string): string {
    if (!text) return '';

    return text
      .toLowerCase()
      .normalize('NFD') // Decompõe caracteres acentuados
      .replace(/[\u0300-\u036f]/g, '') // Remove acentos
      .replace(/\s+/g, ' ') // Normaliza espaços
      .trim();
  }

  /**
   * Verifica se o texto contém respostas afirmativas
   * @param text - Texto a verificar
   * @returns true se for afirmativo
   */
  static isAffirmative(text: string): boolean {
    const normalized = this.normalize(text);
    const affirmatives = [
      'sim',
      's',
      'yes',
      'y',
      'ok',
      'confirmar',
      'confirmo',
      'pode',
      'certo',
      'correto',
      '👍',
      '✅',
    ];

    return affirmatives.some((word) => normalized.includes(word));
  }

  /**
   * Verifica se o texto contém respostas negativas
   * @param text - Texto a verificar
   * @returns true se for negativo
   */
  static isNegative(text: string): boolean {
    const normalized = this.normalize(text);
    const negatives = [
      'nao',
      'não',
      'n',
      'no',
      'cancelar',
      'cancelo',
      'errado',
      'incorreto',
      '👎',
      '❌',
    ];

    return negatives.some((word) => normalized.includes(word));
  }

  /**
   * Trunca texto para um tamanho máximo
   * @param text - Texto original
   * @param maxLength - Tamanho máximo
   * @param suffix - Sufixo a adicionar se truncado (padrão: "...")
   * @returns Texto truncado
   */
  static truncate(text: string, maxLength: number, suffix = '...'): string {
    if (!text || text.length <= maxLength) return text;

    return text.substring(0, maxLength - suffix.length) + suffix;
  }

  /**
   * Remove URLs do texto
   * @param text - Texto original
   * @returns Texto sem URLs
   */
  static removeUrls(text: string): string {
    if (!text) return '';

    return text.replace(
      /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g,
      '',
    );
  }

  /**
   * Extrai emails do texto
   * @param text - Texto original
   * @returns Array de emails encontrados
   */
  static extractEmails(text: string): string[] {
    if (!text) return [];

    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    return text.match(emailRegex) || [];
  }
}

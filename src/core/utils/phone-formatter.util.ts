/**
 * Utilitário para formatação e validação de números de telefone
 */
export class PhoneFormatterUtil {
  /**
   * Normaliza um número de telefone removendo todos os caracteres não numéricos
   * @param phone - Número de telefone
   * @returns Número normalizado (apenas dígitos)
   *
   * @example
   * normalize("+55 11 99999-9999") // "5511999999999"
   * normalize("(11) 99999-9999")   // "11999999999"
   */
  static normalize(phone: string): string {
    if (!phone) return '';
    return phone.replace(/\D/g, '');
  }

  /**
   * Formata número de telefone brasileiro no padrão (XX) XXXXX-XXXX
   * @param phone - Número de telefone
   * @returns Número formatado
   *
   * @example
   * formatBrazilian("5511999999999") // "(11) 99999-9999"
   * formatBrazilian("11999999999")   // "(11) 99999-9999"
   */
  static formatBrazilian(phone: string): string {
    const normalized = this.normalize(phone);

    // Remover código do país se presente (55)
    const withoutCountryCode = normalized.startsWith('55')
      ? normalized.substring(2)
      : normalized;

    // Validar tamanho (deve ter 10 ou 11 dígitos)
    if (withoutCountryCode.length !== 10 && withoutCountryCode.length !== 11) {
      return phone; // Retornar original se inválido
    }

    // Extrair DDD e número
    const ddd = withoutCountryCode.substring(0, 2);
    const number = withoutCountryCode.substring(2);

    // Formatar
    if (number.length === 9) {
      // Celular: (XX) XXXXX-XXXX
      return `(${ddd}) ${number.substring(0, 5)}-${number.substring(5)}`;
    } else {
      // Fixo: (XX) XXXX-XXXX
      return `(${ddd}) ${number.substring(0, 4)}-${number.substring(4)}`;
    }
  }

  /**
   * Adiciona código do país (55) se não presente
   * @param phone - Número de telefone
   * @returns Número com código do país
   *
   * @example
   * addCountryCode("11999999999") // "5511999999999"
   * addCountryCode("5511999999999") // "5511999999999" (já tem código)
   */
  static addCountryCode(phone: string): string {
    const normalized = this.normalize(phone);

    if (normalized.startsWith('55')) {
      return normalized;
    }

    return `55${normalized}`;
  }

  /**
   * Remove código do país (55)
   * @param phone - Número de telefone
   * @returns Número sem código do país
   *
   * @example
   * removeCountryCode("5511999999999") // "11999999999"
   * removeCountryCode("11999999999")   // "11999999999" (já sem código)
   */
  static removeCountryCode(phone: string): string {
    const normalized = this.normalize(phone);

    if (normalized.startsWith('55') && normalized.length > 11) {
      return normalized.substring(2);
    }

    return normalized;
  }

  /**
   * Converte número para JID do WhatsApp
   * @param phone - Número de telefone
   * @returns JID no formato XXXXXXXXXX@s.whatsapp.net
   *
   * @example
   * toWhatsAppJid("5511999999999") // "5511999999999@s.whatsapp.net"
   */
  static toWhatsAppJid(phone: string): string {
    const normalized = this.normalize(phone);
    return `${normalized}@s.whatsapp.net`;
  }

  /**
   * Extrai número do JID do WhatsApp
   * @param jid - JID do WhatsApp
   * @returns Número de telefone
   *
   * @example
   * fromWhatsAppJid("5511999999999@s.whatsapp.net") // "5511999999999"
   */
  static fromWhatsAppJid(jid: string): string {
    return jid.split('@')[0];
  }

  /**
   * Valida se o número de telefone é válido
   * @param phone - Número de telefone
   * @param validateBrazilian - Se true, valida especificamente números brasileiros
   * @returns true se válido
   */
  static isValid(phone: string, validateBrazilian = true): boolean {
    const normalized = this.normalize(phone);

    // Deve ter apenas dígitos
    if (!/^\d+$/.test(normalized)) {
      return false;
    }

    if (validateBrazilian) {
      // Remover código do país se presente
      const withoutCountry = normalized.startsWith('55')
        ? normalized.substring(2)
        : normalized;

      // Número brasileiro deve ter 10 ou 11 dígitos (com DDD)
      return withoutCountry.length === 10 || withoutCountry.length === 11;
    }

    // Validação genérica: pelo menos 8 dígitos
    return normalized.length >= 8;
  }
}

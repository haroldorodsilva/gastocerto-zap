import { Injectable } from '@nestjs/common';

export interface PhoneValidationResult {
  isValid: boolean;
  error?: string;
  normalizedPhone?: string;
  formattedPhone?: string;
}

@Injectable()
export class PhoneValidator {
  /**
   * Valida formato de telefone brasileiro
   * Aceita formatos:
   * - (XX) XXXXX-XXXX
   * - (XX)XXXXX-XXXX
   * - XX XXXXX-XXXX
   * - XXXXXXXXXXX
   * - +55XXXXXXXXXXX
   * - 55XXXXXXXXXXX
   */
  validate(phone: string): PhoneValidationResult {
    if (!phone) {
      return {
        isValid: false,
        error: 'Telefone é obrigatório',
      };
    }

    const trimmedPhone = phone.trim();

    // Remove todos os caracteres não numéricos
    const digitsOnly = trimmedPhone.replace(/\D/g, '');

    // Validar comprimento
    // Brasil: 11 dígitos (DDD + 9 + número) ou 10 dígitos (fixo)
    // Com código país: +55 + 11 dígitos = 13 dígitos
    if (digitsOnly.length < 10 || digitsOnly.length > 13) {
      return {
        isValid: false,
        error:
          '❌ Telefone inválido\n\n' +
          'O telefone deve ter:\n' +
          '• 10 ou 11 dígitos (sem código do país)\n' +
          '• 13 dígitos (com +55)\n\n' +
          'Exemplo: (66) 99628-5154',
      };
    }

    let normalizedPhone = digitsOnly;

    // Se tem código do país (55)
    if (digitsOnly.length === 13 && digitsOnly.startsWith('55')) {
      normalizedPhone = digitsOnly.substring(2); // Remove o 55
    } else if (digitsOnly.length === 12 && digitsOnly.startsWith('55')) {
      // 55 + 10 dígitos (telefone fixo)
      normalizedPhone = digitsOnly.substring(2);
    }

    // Agora normalizedPhone deve ter 10 ou 11 dígitos
    if (normalizedPhone.length !== 10 && normalizedPhone.length !== 11) {
      return {
        isValid: false,
        error:
          '❌ Telefone inválido\n\n' +
          `Após remover o código do país, encontrei ${normalizedPhone.length} dígitos.\n` +
          'Esperado: 10 ou 11 dígitos.\n\n' +
          'Exemplo: (66) 99628-5154',
      };
    }

    // Extrair DDD (2 primeiros dígitos)
    const ddd = normalizedPhone.substring(0, 2);
    const dddNumber = parseInt(ddd);

    // Validar DDD brasileiro (11 a 99)
    if (dddNumber < 11 || dddNumber > 99) {
      return {
        isValid: false,
        error:
          '❌ DDD inválido\n\n' +
          `DDD "${ddd}" não é válido no Brasil.\n` +
          'DDDs válidos vão de 11 a 99.\n\n' +
          'Exemplo: (66) 99628-5154',
      };
    }

    // Validar se é celular (11 dígitos com 9 na frente)
    if (normalizedPhone.length === 11) {
      const ninthDigit = normalizedPhone[2];
      if (ninthDigit !== '9') {
        return {
          isValid: false,
          error:
            '❌ Número de celular inválido\n\n' +
            'Celulares brasileiros têm 11 dígitos e começam com 9.\n\n' +
            'Exemplo: (66) 99628-5154',
        };
      }
    }

    // Verificar se não é um número com todos os dígitos iguais
    const allSameDigit = /^(\d)\1+$/.test(normalizedPhone);
    if (allSameDigit) {
      return {
        isValid: false,
        error:
          '❌ Telefone inválido\n\n' +
          'O número não pode ter todos os dígitos iguais.\n\n' +
          'Exemplo: (66) 99628-5154',
      };
    }

    // Formatar telefone para exibição
    let formattedPhone: string;
    if (normalizedPhone.length === 11) {
      // (XX) 9XXXX-XXXX
      formattedPhone = `(${normalizedPhone.substring(0, 2)}) ${normalizedPhone.substring(2, 7)}-${normalizedPhone.substring(7)}`;
    } else {
      // (XX) XXXX-XXXX
      formattedPhone = `(${normalizedPhone.substring(0, 2)}) ${normalizedPhone.substring(2, 6)}-${normalizedPhone.substring(6)}`;
    }

    return {
      isValid: true,
      normalizedPhone, // Apenas dígitos: 66996285154
      formattedPhone, // Formatado: (66) 99628-5154
    };
  }

  /**
   * Normaliza telefone removendo formatação
   * Retorna apenas dígitos
   */
  normalize(phone: string): string {
    if (!phone) return '';
    const digitsOnly = phone.replace(/\D/g, '');

    // Remove código do país se presente
    if (digitsOnly.length === 13 && digitsOnly.startsWith('55')) {
      return digitsOnly.substring(2);
    }
    if (digitsOnly.length === 12 && digitsOnly.startsWith('55')) {
      return digitsOnly.substring(2);
    }

    return digitsOnly;
  }

  /**
   * Formata telefone para exibição
   */
  format(phone: string): string {
    const normalized = this.normalize(phone);

    if (normalized.length === 11) {
      return `(${normalized.substring(0, 2)}) ${normalized.substring(2, 7)}-${normalized.substring(7)}`;
    } else if (normalized.length === 10) {
      return `(${normalized.substring(0, 2)}) ${normalized.substring(2, 6)}-${normalized.substring(6)}`;
    }

    return phone; // Retorna original se não conseguir formatar
  }

  /**
   * Verifica se é um telefone celular (11 dígitos com 9)
   */
  isCellphone(phone: string): boolean {
    const normalized = this.normalize(phone);
    return normalized.length === 11 && normalized[2] === '9';
  }

  /**
   * Verifica se é um telefone fixo (10 dígitos)
   */
  isLandline(phone: string): boolean {
    const normalized = this.normalize(phone);
    return normalized.length === 10;
  }
}

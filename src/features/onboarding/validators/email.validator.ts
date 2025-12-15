import { Injectable } from '@nestjs/common';

export interface EmailValidationResult {
  isValid: boolean;
  error?: string;
  normalizedEmail?: string;
}

@Injectable()
export class EmailValidator {
  /**
   * Valida formato de email
   */
  validate(email: string): EmailValidationResult {
    if (!email) {
      return {
        isValid: false,
        error: 'Email é obrigatório',
      };
    }

    const trimmedEmail = email.trim();

    // Regex para validação de email
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

    if (!emailRegex.test(trimmedEmail)) {
      return {
        isValid: false,
        error: 'Email inválido. Por favor, informe um email válido (exemplo: seuemail@exemplo.com)',
      };
    }

    // Verificar se o domínio parece válido
    const domain = trimmedEmail.split('@')[1];
    if (!domain || domain.split('.').length < 2) {
      return {
        isValid: false,
        error: 'Domínio do email inválido',
      };
    }

    // Verificar se não tem espaços
    if (trimmedEmail.includes(' ')) {
      return {
        isValid: false,
        error: 'Email não pode conter espaços',
      };
    }

    // Normalizar email (lowercase)
    const normalizedEmail = trimmedEmail.toLowerCase();

    return {
      isValid: true,
      normalizedEmail,
    };
  }

  /**
   * Verifica se email é de um provedor popular (para sugestões)
   */
  isPopularProvider(email: string): boolean {
    const popularProviders = [
      'gmail.com',
      'hotmail.com',
      'outlook.com',
      'yahoo.com',
      'icloud.com',
      'uol.com.br',
      'bol.com.br',
      'terra.com.br',
    ];

    const domain = email.split('@')[1]?.toLowerCase();
    return popularProviders.includes(domain);
  }

  /**
   * Sugere correções para emails com typos comuns
   */
  suggestCorrection(email: string): string | null {
    const typos: Record<string, string> = {
      'gmial.com': 'gmail.com',
      'gmai.com': 'gmail.com',
      'gmaiil.com': 'gmail.com',
      'hotmial.com': 'hotmail.com',
      'hotmai.com': 'hotmail.com',
      'outlok.com': 'outlook.com',
      'outllok.com': 'outlook.com',
      'yahooo.com': 'yahoo.com',
      'yaho.com': 'yahoo.com',
    };

    const [localPart, domain] = email.toLowerCase().split('@');

    if (typos[domain]) {
      return `${localPart}@${typos[domain]}`;
    }

    return null;
  }
}

import { Injectable } from '@nestjs/common';

export interface NameValidationResult {
  isValid: boolean;
  error?: string;
  normalizedName?: string;
}

@Injectable()
export class NameValidator {
  /**
   * Valida nome completo
   */
  validate(name: string): NameValidationResult {
    if (!name) {
      return {
        isValid: false,
        error: 'Nome é obrigatório',
      };
    }

    const trimmedName = name.trim();

    // Verificar tamanho mínimo
    if (trimmedName.length < 3) {
      return {
        isValid: false,
        error: 'Nome muito curto. Por favor, informe seu nome completo',
      };
    }

    // Verificar tamanho máximo
    if (trimmedName.length > 100) {
      return {
        isValid: false,
        error: 'Nome muito longo. Por favor, informe um nome com até 100 caracteres',
      };
    }

    // Verificar se contém pelo menos 2 palavras (nome e sobrenome)
    const words = trimmedName.split(/\s+/).filter((word) => word.length > 0);
    if (words.length < 2) {
      return {
        isValid: false,
        error: 'Por favor, informe seu nome completo (nome e sobrenome)',
      };
    }

    // Verificar se contém apenas letras, espaços e caracteres acentuados
    const nameRegex = /^[a-zA-ZÀ-ÿ\s'-]+$/;
    if (!nameRegex.test(trimmedName)) {
      return {
        isValid: false,
        error: 'Nome contém caracteres inválidos. Use apenas letras',
      };
    }

    // Verificar se não contém números
    if (/\d/.test(trimmedName)) {
      return {
        isValid: false,
        error: 'Nome não pode conter números',
      };
    }

    // Normalizar nome (Title Case)
    const normalizedName = this.toTitleCase(trimmedName);

    return {
      isValid: true,
      normalizedName,
    };
  }

  /**
   * Converte nome para Title Case (Primeira Letra Maiúscula)
   */
  private toTitleCase(name: string): string {
    const exceptions = ['de', 'da', 'do', 'das', 'dos', 'e'];

    return name
      .toLowerCase()
      .split(/\s+/)
      .map((word, index) => {
        // Primeira palavra sempre maiúscula, mesmo que seja exceção
        if (index === 0 || !exceptions.includes(word)) {
          return word.charAt(0).toUpperCase() + word.slice(1);
        }
        return word;
      })
      .join(' ');
  }

  /**
   * Valida se o nome parece real (não é spam/teste)
   */
  seemsReal(name: string): boolean {
    const suspiciousPatterns = [
      /^teste/i,
      /^test/i,
      /^aaa+/i,
      /^xxx+/i,
      /^111+/,
      /^asdf/i,
      /^qwerty/i,
    ];

    return !suspiciousPatterns.some((pattern) => pattern.test(name));
  }
}

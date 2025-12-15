import { Injectable, Logger } from '@nestjs/common';
import { TransactionData } from '../../infrastructure/ai/ai.interface';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

@Injectable()
export class TransactionValidatorService {
  private readonly logger = new Logger(TransactionValidatorService.name);

  /**
   * Valida dados de transação extraídos pela IA
   */
  validate(data: TransactionData): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validar valor
    if (!data.amount || data.amount <= 0) {
      errors.push('Valor inválido ou zero');
    }

    if (data.amount > 1000000) {
      warnings.push('Valor muito alto (> R$ 1.000.000). Confirme se está correto.');
    }

    // Validar tipo
    if (!data.type || !['EXPENSES', 'INCOME'].includes(data.type)) {
      errors.push('Tipo de transação inválido');
    }

    // Validar categoria
    if (!data.category || data.category.trim().length === 0) {
      errors.push('Categoria não informada');
    }

    // Validar confiança
    if (data.confidence < 0.3) {
      warnings.push('Baixa confiança na extração (< 30%). Revise os dados.');
    }

    // Validar data (se fornecida)
    if (data.date) {
      const now = new Date();
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(now.getFullYear() - 1);

      const oneMonthAhead = new Date();
      oneMonthAhead.setMonth(now.getMonth() + 1);

      if (data.date < oneYearAgo) {
        warnings.push('Data muito antiga (> 1 ano). Confirme se está correta.');
      }

      if (data.date > oneMonthAhead) {
        warnings.push('Data futura. Confirme se está correta.');
      }
    }

    const isValid = errors.length === 0;

    if (!isValid) {
      this.logger.warn(`Validação falhou: ${errors.join(', ')}`);
    }

    if (warnings.length > 0) {
      this.logger.debug(`Avisos: ${warnings.join(', ')}`);
    }

    return { isValid, errors, warnings };
  }

  /**
   * Sanitiza descrição (remove caracteres especiais, limita tamanho)
   */
  sanitizeDescription(description: string): string {
    if (!description) return '';

    return description
      .trim()
      .substring(0, 200) // Max 200 caracteres
      .replace(/[^\w\s\-.,]/g, ''); // Remove caracteres especiais
  }

  /**
   * Normaliza categoria (Title Case, limita tamanho)
   */
  normalizeCategory(category: string): string {
    if (!category) return 'Outros';

    return category
      .trim()
      .substring(0, 50) // Max 50 caracteres
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Formata valor para exibição
   */
  formatAmount(amount: number): string {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(amount);
  }

  /**
   * Formata data para exibição
   */
  formatDate(date: Date): string {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  }

  /**
   * Verifica se valor parece suspeito (números redondos demais)
   */
  seemsSuspicious(amount: number): boolean {
    // Valores como 100.00, 1000.00 podem ser imprecisos
    const isRound = amount % 100 === 0 && amount >= 100;
    return isRound;
  }
}

import { Injectable } from '@nestjs/common';
import { TransactionData, TransactionType, AIProviderType } from './ai.interface';

/**
 * Serviço centralizado para normalização de dados de transação
 * Garante formato consistente independente do provider de IA usado
 */
@Injectable()
export class AINormalizationService {
  /**
   * Normaliza dados extraídos por qualquer provider para formato padrão
   *
   * @param data - Dados brutos retornados pelo provider de IA
   * @param provider - Tipo do provider que extraiu os dados
   * @returns Dados normalizados no formato TransactionData
   */
  normalizeTransactionData(data: any, provider: AIProviderType): TransactionData {
    if (!data) {
      throw new Error(`Provider ${provider} returned null/undefined data`);
    }

    // Normaliza o tipo de transação (INCOME ou EXPENSES)
    const type = this.normalizeTransactionType(data.type || data.tipo);

    // Normaliza o valor monetário
    const amount = this.normalizeAmount(data.amount || data.valor);

    // Normaliza a categoria
    const category = this.normalizeCategory(data.category || data.categoria);

    // Normaliza a descrição
    const description = this.normalizeDescription(data.description || data.descricao);

    // Normaliza o estabelecimento/comerciante
    const merchant = this.normalizeMerchant(data.merchant || data.estabelecimento);

    // Normaliza a data
    const date = this.normalizeDate(data.date || data.data);

    // Normaliza a confiança
    const confidence = this.normalizeConfidence(data.confidence || data.confianca);

    return {
      type,
      amount,
      category,
      description,
      merchant,
      date,
      confidence,
    };
  }

  /**
   * Normaliza o tipo de transação
   */
  private normalizeTransactionType(type: any): TransactionType {
    if (!type) {
      return TransactionType.EXPENSES;
    }

    const typeUpper = String(type).toUpperCase();

    if (typeUpper === 'INCOME' || typeUpper === 'RECEITA' || typeUpper === 'ENTRADA') {
      return TransactionType.INCOME;
    }

    return TransactionType.EXPENSES;
  }

  /**
   * Normaliza o valor monetário
   */
  private normalizeAmount(amount: any): number {
    if (typeof amount === 'number') {
      return Math.abs(amount);
    }

    if (typeof amount === 'string') {
      // Remove caracteres não numéricos exceto ponto e vírgula
      const cleaned = amount.replace(/[^\d.,\-]/g, '');
      // Substitui vírgula por ponto
      const normalized = cleaned.replace(',', '.');
      const parsed = parseFloat(normalized);

      return isNaN(parsed) ? 0 : Math.abs(parsed);
    }

    return 0;
  }

  /**
   * Normaliza a categoria
   */
  private normalizeCategory(category: any): string {
    if (!category) {
      return 'Outros';
    }

    const categoryStr = String(category).trim();

    // Se a categoria estiver vazia após trim, retorna "Outros"
    return categoryStr || 'Outros';
  }

  /**
   * Normaliza a descrição
   */
  private normalizeDescription(description: any): string {
    if (!description) {
      return '';
    }

    return String(description).trim();
  }

  /**
   * Normaliza o estabelecimento/comerciante
   */
  private normalizeMerchant(merchant: any): string | undefined {
    if (!merchant) {
      return undefined;
    }

    const merchantStr = String(merchant).trim();

    // Retorna undefined se vazio após trim
    return merchantStr || undefined;
  }

  /**
   * Normaliza a data
   */
  private normalizeDate(date: any): Date {
    if (!date) {
      return new Date();
    }

    if (date instanceof Date) {
      return date;
    }

    // Tenta parsear string de data
    if (typeof date === 'string') {
      const parsed = new Date(date);

      // Verifica se a data é válida
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    // Se não conseguiu parsear, retorna data atual
    return new Date();
  }

  /**
   * Normaliza a confiança (0 a 1)
   */
  private normalizeConfidence(confidence: any): number {
    if (typeof confidence === 'number') {
      // Garante que está entre 0 e 1
      return Math.max(0, Math.min(1, confidence));
    }

    if (typeof confidence === 'string') {
      const parsed = parseFloat(confidence);

      if (!isNaN(parsed)) {
        return Math.max(0, Math.min(1, parsed));
      }
    }

    // Confiança padrão
    return 0.8;
  }

  /**
   * Valida se os dados normalizados são válidos
   *
   * @param data - Dados normalizados
   * @returns true se válidos, false caso contrário
   */
  validateNormalizedData(data: TransactionData): boolean {
    // Validações básicas
    if (
      !data.type ||
      (data.type !== TransactionType.INCOME && data.type !== TransactionType.EXPENSES)
    ) {
      return false;
    }

    if (typeof data.amount !== 'number' || data.amount < 0) {
      return false;
    }

    if (!data.category || typeof data.category !== 'string') {
      return false;
    }

    if (!(data.date instanceof Date) || isNaN(data.date.getTime())) {
      return false;
    }

    if (typeof data.confidence !== 'number' || data.confidence < 0 || data.confidence > 1) {
      return false;
    }

    return true;
  }
}

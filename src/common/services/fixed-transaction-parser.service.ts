import { Injectable, Logger } from '@nestjs/common';

export interface FixedTransactionDetectionResult {
  isFixed: boolean;
  frequency?: 'MONTHLY' | 'WEEKLY' | 'ANNUAL' | 'BIENNIAL';
  confidence: number;
  matchedKeywords?: string[];
}

@Injectable()
export class FixedTransactionParserService {
  private readonly logger = new Logger(FixedTransactionParserService.name);

  /**
   * Palavras-chave que indicam transação fixa/recorrente
   */
  private readonly FIXED_KEYWORDS = {
    MONTHLY: [
      'todo mes',
      'todos os meses',
      'todo mês',
      'todos os mêses',
      'mensal',
      'mensalmente',
      'mensalidade',
      'assinatura',
      'recorrente',
      'fixo',
      'fixa',
    ],
    WEEKLY: ['toda semana', 'todas as semanas', 'semanal', 'semanalmente'],
    ANNUAL: ['todo ano', 'todos os anos', 'anual', 'anualmente', 'anuidade'],
    BIENNIAL: ['bienal', 'bienalmente', 'a cada 2 anos', 'cada dois anos'],
  };

  /**
   * Detecta se é transação fixa/recorrente
   */
  detectFixed(text: string): FixedTransactionDetectionResult {
    const normalizedText = text.toLowerCase().trim();
    const matchedKeywords: string[] = [];

    // Verificar cada frequência
    for (const [frequency, keywords] of Object.entries(this.FIXED_KEYWORDS)) {
      for (const keyword of keywords) {
        if (normalizedText.includes(keyword)) {
          matchedKeywords.push(keyword);

          this.logger.log(`✅ Transação fixa detectada: ${frequency} (keyword: "${keyword}")`);

          return {
            isFixed: true,
            frequency: frequency as any,
            confidence: 0.9,
            matchedKeywords,
          };
        }
      }
    }

    // Não detectado
    return {
      isFixed: false,
      confidence: 0,
    };
  }
}

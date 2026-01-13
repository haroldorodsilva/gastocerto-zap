import { Injectable, Logger } from '@nestjs/common';

export interface CreditCardDetectionResult {
  usesCreditCard: boolean;
  confidence: number;
  matchedKeywords?: string[];
}

@Injectable()
export class CreditCardParserService {
  private readonly logger = new Logger(CreditCardParserService.name);

  /**
   * Palavras-chave que indicam uso de cartão de crédito
   */
  private readonly CREDIT_CARD_KEYWORDS = [
    'cartao',
    'cartão',
    'credito',
    'crédito',
    'cartao de credito',
    'cartão de crédito',
    'no cartao',
    'no cartão',
    'com o cartao',
    'com o cartão',
    'passei o cartao',
    'passei o cartão',
    'paguei no credito',
    'paguei no crédito',
  ];

  /**
   * Detecta se a transação foi feita com cartão de crédito
   */
  detectCreditCard(text: string): CreditCardDetectionResult {
    const normalizedText = text.toLowerCase().trim();
    const matchedKeywords: string[] = [];

    for (const keyword of this.CREDIT_CARD_KEYWORDS) {
      if (normalizedText.includes(keyword)) {
        matchedKeywords.push(keyword);
      }
    }

    if (matchedKeywords.length > 0) {
      this.logger.log(`✅ Cartão de crédito detectado (keywords: ${matchedKeywords.join(', ')})`);

      return {
        usesCreditCard: true,
        confidence: 0.9,
        matchedKeywords,
      };
    }

    return {
      usesCreditCard: false,
      confidence: 0,
    };
  }
}

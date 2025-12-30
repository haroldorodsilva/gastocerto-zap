import { Injectable, Logger } from '@nestjs/common';

export interface InstallmentDetectionResult {
  isInstallment: boolean;
  installments?: number;
  confidence: number;
  matchedPattern?: string;
}

@Injectable()
export class InstallmentParserService {
  private readonly logger = new Logger(InstallmentParserService.name);

  /**
   * Padrões para detectar parcelamento
   *
   * Exemplos suportados:
   * - "4x", "4 x", "4 vezes"
   * - "em 4", "em 4 vezes", "em quatro vezes"
   * - "parcelado em 5", "parcelei em 3"
   * - "5 parcelas", "3 parcelas"
   */
  private readonly INSTALLMENT_PATTERNS = [
    // Padrão: "4x" ou "4 x"
    /(\d{1,2})\s?x\b/i,

    // Padrão: "em 4" ou "em 4 vezes"
    /em\s+(\d{1,2})(\s+vezes?)?/i,

    // Padrão: "parcelado em 5" ou "parcelei em 3"
    /parcel[aeio]+\s+em\s+(\d{1,2})/i,

    // Padrão: "5 parcelas" ou "3 parcela"
    /(\d{1,2})\s+parcelas?/i,

    // Padrão: "dividido em 4"
    /dividi[dr]o?\s+em\s+(\d{1,2})/i,
  ];

  /**
   * Mapa de números por extenso (português)
   */
  private readonly NUMBER_WORDS: Record<string, number> = {
    um: 1,
    uma: 1,
    dois: 2,
    duas: 2,
    tres: 3,
    três: 3,
    quatro: 4,
    cinco: 5,
    seis: 6,
    sete: 7,
    oito: 8,
    nove: 9,
    dez: 10,
    onze: 11,
    doze: 12,
    treze: 13,
    quatorze: 14,
    quinze: 15,
    dezesseis: 16,
    dezessete: 17,
    dezoito: 18,
    dezenove: 19,
    vinte: 20,
  };

  /**
   * Detecta se o texto contém informação de parcelamento
   */
  detectInstallments(text: string): InstallmentDetectionResult {
    const normalizedText = text.toLowerCase().trim();

    // 1. Tentar padrões numéricos primeiro (4x, em 4, etc.)
    for (const pattern of this.INSTALLMENT_PATTERNS) {
      const match = normalizedText.match(pattern);
      if (match) {
        const installments = parseInt(match[1], 10);

        // Validar: parcelas entre 2 e 24
        if (installments >= 2 && installments <= 24) {
          this.logger.log(`✅ Parcelamento detectado: ${installments}x (padrão: ${pattern})`);
          return {
            isInstallment: true,
            installments,
            confidence: 0.9,
            matchedPattern: match[0],
          };
        }
      }
    }

    // 2. Tentar números por extenso
    const installments = this.detectNumberWords(normalizedText);
    if (installments) {
      this.logger.log(`✅ Parcelamento detectado: ${installments}x (por extenso)`);
      return {
        isInstallment: true,
        installments,
        confidence: 0.85,
        matchedPattern: 'numero_extenso',
      };
    }

    // 3. Não detectado
    return {
      isInstallment: false,
      confidence: 0,
    };
  }

  /**
   * Detecta números por extenso em frases de parcelamento
   * Ex: "em cinco vezes", "parcelei em quatro"
   */
  private detectNumberWords(text: string): number | null {
    // Padrões que indicam parcelamento com número por extenso
    const patterns = [
      /em\s+(\w+)\s+vezes?/i, // "em cinco vezes"
      /parcel\w+\s+em\s+(\w+)/i, // "parcelei em quatro"
      /dividi\w+\s+em\s+(\w+)/i, // "dividi em três"
      /(\w+)\s+parcelas?/i, // "cinco parcelas"
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const word = match[1].toLowerCase();
        const number = this.NUMBER_WORDS[word];

        if (number && number >= 2 && number <= 24) {
          return number;
        }
      }
    }

    return null;
  }

  /**
   * Valida se o número de parcelas é razoável
   */
  isValidInstallmentCount(installments: number): boolean {
    return installments >= 2 && installments <= 24;
  }
}

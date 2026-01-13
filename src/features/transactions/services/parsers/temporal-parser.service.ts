import { Injectable, Logger } from '@nestjs/common';
import {
  addDays,
  addWeeks,
  addMonths,
  subDays,
  subWeeks,
  subMonths,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  setDate,
  isBefore,
} from 'date-fns';

/**
 * Enum para referências temporais detectadas
 */
export enum TimeReference {
  TODAY = 'TODAY',
  YESTERDAY = 'YESTERDAY',
  TOMORROW = 'TOMORROW',
  DAY_BEFORE_YESTERDAY = 'DAY_BEFORE_YESTERDAY',
  LAST_WEEK = 'LAST_WEEK',
  THIS_WEEK = 'THIS_WEEK',
  NEXT_WEEK = 'NEXT_WEEK',
  LAST_MONTH = 'LAST_MONTH',
  THIS_MONTH = 'THIS_MONTH',
  NEXT_MONTH = 'NEXT_MONTH',
  BEGINNING_OF_WEEK = 'BEGINNING_OF_WEEK',
  END_OF_WEEK = 'END_OF_WEEK',
  BEGINNING_OF_MONTH = 'BEGINNING_OF_MONTH',
  END_OF_MONTH = 'END_OF_MONTH',
}

/**
 * Interface para resultado da análise temporal
 */
export interface TemporalAnalysis {
  /** Referência temporal detectada */
  timeReference: TimeReference | null;
  /** Dia específico mencionado (1-31) */
  specificDay: number | null;
  /** Texto normalizado que foi analisado */
  normalizedText: string;
  /** Confiança da detecção (0-1) */
  confidence: number;
}

/**
 * Service para análise e cálculo de expressões temporais
 */
@Injectable()
export class TemporalParserService {
  private readonly logger = new Logger(TemporalParserService.name);

  /**
   * Padrões de expressões temporais em português
   */
  private readonly temporalPatterns: Array<{
    pattern: RegExp;
    reference: TimeReference;
    confidence: number;
  }> = [
    // Hoje
    { pattern: /\bhoje\b/i, reference: TimeReference.TODAY, confidence: 1.0 },

    // Ontem
    { pattern: /\bontem\b/i, reference: TimeReference.YESTERDAY, confidence: 1.0 },

    // Amanhã
    {
      pattern: /\b(amanh[ãa]|amanha)\b/i,
      reference: TimeReference.TOMORROW,
      confidence: 1.0,
    },

    // Anteontem
    {
      pattern: /\b(anteontem|antes de ontem)\b/i,
      reference: TimeReference.DAY_BEFORE_YESTERDAY,
      confidence: 1.0,
    },

    // Semana passada
    {
      pattern: /\b(semana passada|semana que passou|ultima semana|última semana)\b/i,
      reference: TimeReference.LAST_WEEK,
      confidence: 0.9,
    },

    // Esta semana
    {
      pattern: /\b(esta semana|essa semana|nesta semana|nessa semana)\b/i,
      reference: TimeReference.THIS_WEEK,
      confidence: 0.9,
    },

    // Próxima semana
    {
      pattern: /\b(pr[óo]xima semana|proxima semana|semana que vem|semana seguinte)\b/i,
      reference: TimeReference.NEXT_WEEK,
      confidence: 0.9,
    },

    // Mês passado
    {
      pattern: /\b(m[êe]s passado|mes passado|ultimo mes|último mês)\b/i,
      reference: TimeReference.LAST_MONTH,
      confidence: 0.9,
    },

    // Este mês
    {
      pattern: /\b(este m[êe]s|esse mes|neste mes|nesse mês)\b/i,
      reference: TimeReference.THIS_MONTH,
      confidence: 0.9,
    },

    // Próximo mês
    {
      pattern: /\b(pr[óo]ximo m[êe]s|proximo mes|mes que vem|mês que vem|mes seguinte)\b/i,
      reference: TimeReference.NEXT_MONTH,
      confidence: 0.9,
    },

    // Início da semana
    {
      pattern: /\b(in[ií]cio da semana|inicio da semana|come[çc]o da semana)\b/i,
      reference: TimeReference.BEGINNING_OF_WEEK,
      confidence: 0.85,
    },

    // Fim da semana
    {
      pattern: /\b(fim da semana|final da semana|fim de semana)\b/i,
      reference: TimeReference.END_OF_WEEK,
      confidence: 0.85,
    },

    // Início do mês
    {
      pattern: /\b(in[ií]cio do m[êe]s|inicio do mes|come[çc]o do mes)\b/i,
      reference: TimeReference.BEGINNING_OF_MONTH,
      confidence: 0.85,
    },

    // Fim do mês
    {
      pattern: /\b(fim do m[êe]s|fim do mes|final do mes)\b/i,
      reference: TimeReference.END_OF_MONTH,
      confidence: 0.85,
    },
  ];

  /**
   * Analisa texto para detectar expressões temporais
   */
  parseTemporalExpression(text: string): TemporalAnalysis {
    const normalizedText = text.toLowerCase().trim();

    // 1. Buscar referência temporal nos padrões
    let timeReference: TimeReference | null = null;
    let confidence = 0;

    for (const { pattern, reference, confidence: patternConfidence } of this.temporalPatterns) {
      if (pattern.test(normalizedText)) {
        timeReference = reference;
        confidence = patternConfidence;
        this.logger.debug(
          `🕐 Referência temporal detectada: ${reference} (confiança: ${confidence})`,
        );
        break;
      }
    }

    // 2. Buscar dia específico mencionado (dia 15, dia 25, etc)
    const specificDay = this.extractSpecificDay(normalizedText);

    if (specificDay) {
      this.logger.debug(`📅 Dia específico detectado: ${specificDay}`);
      // Se encontrou dia específico, aumentar confiança
      confidence = Math.max(confidence, 0.95);
    }

    return {
      timeReference,
      specificDay,
      normalizedText,
      confidence,
    };
  }

  /**
   * Extrai dia específico do texto (ex: "dia 15", "dia 25")
   */
  private extractSpecificDay(text: string): number | null {
    // Padrões: "dia 15", "dia 25/12", "no dia 10"
    const dayPatterns = [
      /\bdia\s+(\d{1,2})\b/i, // "dia 15"
      /\bno\s+dia\s+(\d{1,2})\b/i, // "no dia 15"
      /\b(\d{1,2})\s+de\s+\w+/i, // "15 de dezembro"
    ];

    for (const pattern of dayPatterns) {
      const match = text.match(pattern);
      if (match) {
        const day = parseInt(match[1], 10);
        // Validar dia (1-31)
        if (day >= 1 && day <= 31) {
          return day;
        }
      }
    }

    return null;
  }

  /**
   * Calcula a data baseado na referência temporal e dia específico
   *
   * @param baseDate Data base (normalmente hoje)
   * @param timeReference Referência temporal (YESTERDAY, NEXT_MONTH, etc)
   * @param specificDay Dia específico (1-31) ou null
   * @returns Data calculada
   */
  calculateDate(
    baseDate: Date,
    timeReference: TimeReference | null,
    specificDay: number | null = null,
  ): Date {
    let resultDate = new Date(baseDate);

    // Se não tem referência temporal, retornar data base
    if (!timeReference) {
      this.logger.debug(`📅 Sem referência temporal, usando data base: ${baseDate}`);
      return resultDate;
    }

    // Calcular data baseado na referência temporal
    switch (timeReference) {
      case TimeReference.TODAY:
        // Já é a data base
        break;

      case TimeReference.YESTERDAY:
        resultDate = subDays(baseDate, 1);
        break;

      case TimeReference.TOMORROW:
        resultDate = addDays(baseDate, 1);
        break;

      case TimeReference.DAY_BEFORE_YESTERDAY:
        resultDate = subDays(baseDate, 2);
        break;

      case TimeReference.LAST_WEEK:
        resultDate = subWeeks(baseDate, 1);
        break;

      case TimeReference.THIS_WEEK:
        // Mantém semana atual
        break;

      case TimeReference.NEXT_WEEK:
        resultDate = addWeeks(baseDate, 1);
        break;

      case TimeReference.LAST_MONTH:
        resultDate = subMonths(baseDate, 1);
        break;

      case TimeReference.THIS_MONTH:
        // Mantém mês atual
        break;

      case TimeReference.NEXT_MONTH:
        resultDate = addMonths(baseDate, 1);
        break;

      case TimeReference.BEGINNING_OF_WEEK:
        resultDate = startOfWeek(baseDate, { weekStartsOn: 0 }); // Domingo
        break;

      case TimeReference.END_OF_WEEK:
        resultDate = endOfWeek(baseDate, { weekStartsOn: 0 }); // Sábado
        break;

      case TimeReference.BEGINNING_OF_MONTH:
        resultDate = startOfMonth(baseDate);
        break;

      case TimeReference.END_OF_MONTH:
        resultDate = endOfMonth(baseDate);
        break;

      default:
        this.logger.warn(`⚠️ Referência temporal desconhecida: ${timeReference}`);
    }

    // Se tem dia específico E a referência é de mês, setar o dia
    if (
      specificDay &&
      (timeReference === TimeReference.LAST_MONTH ||
        timeReference === TimeReference.THIS_MONTH ||
        timeReference === TimeReference.NEXT_MONTH)
    ) {
      try {
        resultDate = setDate(resultDate, specificDay);
        this.logger.debug(`📅 Dia específico ${specificDay} aplicado: ${resultDate.toISOString()}`);
      } catch (error) {
        this.logger.warn(`⚠️ Erro ao setar dia ${specificDay}, mantendo data calculada`);
      }
    }

    this.logger.debug(
      `📅 Data calculada: ${resultDate.toISOString()} (base: ${baseDate.toISOString()}, ref: ${timeReference}, dia: ${specificDay})`,
    );

    return resultDate;
  }

  /**
   * Método auxiliar para análise e cálculo em uma única chamada
   */
  parseAndCalculateDate(text: string, baseDate: Date = new Date()): Date {
    const analysis = this.parseTemporalExpression(text);
    return this.calculateDate(baseDate, analysis.timeReference, analysis.specificDay);
  }
}

import {
  addMonths,
  format,
  parseISO,
  isValid,
  parse,
  isAfter,
  isBefore,
  min,
  max,
  differenceInDays,
  addSeconds,
} from 'date-fns';
import { BadRequestException } from '@nestjs/common';

/**
 * Classe utilitária para manipulação consistente de datas em transações
 * Esta classe centraliza toda a lógica de datas para prevenir inconsistências
 * e garantir que todas as operações sejam timezone-safe
 */
export class DateUtil {
  /**
   * Timezone padrão da aplicação (UTC)
   */
  private static readonly APP_TIMEZONE = 'UTC';

  /**
   * Formatos de data aceitos pela aplicação
   */
  private static readonly ACCEPTED_DATE_FORMATS = [
    'yyyy-MM-dd',
    'dd/MM/yyyy',
    'yyyy-MM-dd HH:mm:ss',
    'dd/MM/yyyy HH:mm:ss',
  ];

  /**
   * Converte qualquer entrada de data para um objeto Date UTC válido
   * @param dateInput - String, Date ou número representando a data
   * @returns Date object UTC válido
   * @throws BadRequestException se a data for inválida
   */
  static normalizeDate(dateInput: string | Date | number): Date {
    if (!dateInput && dateInput !== 0) {
      throw new BadRequestException('Data é obrigatória');
    }

    let date: Date;

    if (dateInput instanceof Date) {
      date = new Date(dateInput);
    } else if (typeof dateInput === 'string') {
      // Para strings ISO como '2025-10-15', cria date diretamente em UTC
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
        const [year, month, day] = dateInput.split('-').map(Number);

        // Valida se a data é válida
        if (month < 1 || month > 12 || day < 1 || day > 31) {
          throw new BadRequestException('Data inválida fornecida');
        }

        const result = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));

        // Verifica se a data realmente existe (ex: 31 de fevereiro)
        if (
          result.getUTCFullYear() !== year ||
          result.getUTCMonth() !== month - 1 ||
          result.getUTCDate() !== day
        ) {
          throw new BadRequestException('Data inválida fornecida');
        }

        return result;
      }

      // Tenta fazer parse com ISO primeiro
      date = parseISO(dateInput);

      // Se não funcionou, tenta com os formatos aceitos
      if (!isValid(date)) {
        for (const dateFormat of this.ACCEPTED_DATE_FORMATS) {
          try {
            date = parse(dateInput, dateFormat, new Date());
            if (isValid(date)) break;
          } catch {
            continue;
          }
        }
      }
    } else if (typeof dateInput === 'number') {
      date = new Date(dateInput);
    } else {
      throw new BadRequestException('Formato de data inválido');
    }

    if (!isValid(date)) {
      throw new BadRequestException('Data inválida fornecida');
    }

    // Garante que a data seja em UTC
    return this.toUTC(date);
  }

  /**
   * Converte uma data para UTC mantendo os valores de ano/mês/dia
   * @param date - Data a ser convertida
   * @returns Date em UTC
   */
  static toUTC(date: Date): Date {
    // Para timestamps (números), usa os valores UTC diretamente
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0),
    );
  }

  /**
   * Obtém o primeiro dia do mês em UTC
   * @param date - Data de referência
   * @returns Date representando o primeiro dia do mês
   */
  static getStartOfMonth(date: Date): Date {
    const normalized = this.normalizeDate(date);
    return new Date(Date.UTC(normalized.getUTCFullYear(), normalized.getUTCMonth(), 1, 0, 0, 0, 0));
  }

  /**
   * Obtém o último dia do mês em UTC
   * @param date - Data de referência
   * @returns Date representando o último dia do mês
   */
  static getEndOfMonth(date: Date): Date {
    const normalized = this.normalizeDate(date);
    // Obtém o último dia do mês
    const lastDay = new Date(
      Date.UTC(normalized.getUTCFullYear(), normalized.getUTCMonth() + 1, 0),
    ).getUTCDate();
    return new Date(
      Date.UTC(normalized.getUTCFullYear(), normalized.getUTCMonth(), lastDay, 0, 0, 0, 0),
    );
  }

  /**
   * Obtém o range de datas para um mês específico
   * @param year - Ano
   * @param month - Mês (1-12)
   * @returns Objeto com startDate e endDate em UTC
   */
  static getMonthRange(year: number, month: number): { startDate: Date; endDate: Date } {
    this.validateYearMonth(year, month);

    const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    return { startDate, endDate };
  }

  /**
   * Obtém o range de datas para um ano específico
   * @param year - Ano
   * @returns Objeto com startDate e endDate em UTC
   */
  static getYearRange(year: number): { startDate: Date; endDate: Date } {
    this.validateYear(year);

    const startDate = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
    const endDate = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

    return { startDate, endDate };
  }

  /**
   * Extrai o formato YYYY-MM de uma data
   * @param date - Data para extrair o mês/ano
   * @returns String no formato YYYY-MM
   */
  static getYearMonth(date: Date | string): string {
    const normalized = this.normalizeDate(date);
    const year = normalized.getUTCFullYear();
    const month = (normalized.getUTCMonth() + 1).toString().padStart(2, '0');
    return `${year}-${month}`;
  }

  /**
   * Converte um string YYYY-MM para Date (dia 15 do mês para evitar problemas de timezone)
   * @param yearMonth - String no formato YYYY-MM
   * @returns Date representando o meio do mês
   */
  static yearMonthToDate(yearMonth: string): Date {
    if (!this.isValidYearMonth(yearMonth)) {
      throw new BadRequestException('Formato de ano/mês inválido. Use YYYY-MM');
    }

    const [year, month] = yearMonth.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, 15, 12, 0, 0));
  }

  /**
   * Adiciona meses a uma data de forma segura
   * @param date - Data base
   * @param months - Número de meses a adicionar (pode ser negativo)
   * @returns Nova data com os meses adicionados
   */
  static addMonths(date: Date | string, months: number): Date {
    const normalized = this.normalizeDate(date);
    const result = addMonths(normalized, months);

    // Garante que o resultado seja UTC
    return new Date(
      Date.UTC(result.getUTCFullYear(), result.getUTCMonth(), result.getUTCDate(), 0, 0, 0, 0),
    );
  }

  /**
   * Subtrai meses de uma data de forma segura
   * @param date - Data base
   * @param months - Número de meses a subtrair
   * @returns Nova data com os meses subtraídos
   */
  static subtractMonths(date: Date | string, months: number): Date {
    return this.addMonths(date, -months);
  }

  /**
   * Verifica se duas datas estão no mesmo mês
   * @param date1 - Primeira data
   * @param date2 - Segunda data
   * @returns true se estão no mesmo mês
   */
  static isSameMonth(date1: Date | string, date2: Date | string): boolean {
    // Compatibilidade: se qualquer data for null/undefined, retorna false
    if (!date1 || !date2) {
      return false;
    }

    const normalized1 = this.normalizeDate(date1);
    const normalized2 = this.normalizeDate(date2);

    return (
      normalized1.getUTCFullYear() === normalized2.getUTCFullYear() &&
      normalized1.getUTCMonth() === normalized2.getUTCMonth()
    );
  } /**
   * Verifica se o mês mudou entre duas datas
   * @param oldDate - Data anterior
   * @param newDate - Data nova
   * @returns true se o mês mudou
   */
  static hasMonthChanged(oldDate: Date | string, newDate: Date | string): boolean {
    // Compatibilidade: se qualquer data for null/undefined, retorna false
    if (!oldDate || !newDate) {
      return false;
    }
    return !this.isSameMonth(oldDate, newDate);
  }

  /**
   * Muda o dia de uma data mantendo mês e ano
   * @param date - Data base
   * @param newDay - Novo dia do mês
   * @returns Nova data com o dia alterado
   */
  static changeDay(date: Date | string, newDay: number): Date {
    const normalized = this.normalizeDate(date);

    if (newDay < 1 || newDay > 31) {
      throw new BadRequestException('Dia deve estar entre 1 e 31');
    }

    const year = normalized.getUTCFullYear();
    const month = normalized.getUTCMonth();

    // Obtém o último dia do mês para validação
    const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

    // Se o dia solicitado não existe no mês, usa o último dia do mês
    const adjustedDay = Math.min(newDay, lastDayOfMonth);

    return new Date(Date.UTC(year, month, adjustedDay, 0, 0, 0));
  }

  /**
   * Calcula a data de vencimento de uma transação fixa
   * @param referenceDate - Data de referência (geralmente a data atual)
   * @param dueDay - Dia do vencimento (1-31)
   * @returns Data de vencimento calculada
   */
  static calculateFixedDueDate(referenceDate: Date | string, dueDay: number): Date {
    const normalized = this.normalizeDate(referenceDate);
    return this.changeDay(normalized, dueDay);
  }

  /**
   * Calcula a data de fechamento de uma fatura
   * @param year - Ano
   * @param month - Mês (1-12)
   * @param closingDay - Dia do fechamento
   * @returns Data de fechamento
   */
  static calculateClosingDate(year: number, month: number, closingDay: number): Date {
    this.validateYearMonth(year, month);

    if (closingDay < 1 || closingDay > 31) {
      throw new BadRequestException('Dia de fechamento deve estar entre 1 e 31');
    }

    // Obtém o último dia do mês para validação
    const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const adjustedDay = Math.min(closingDay, lastDayOfMonth);

    return new Date(Date.UTC(year, month - 1, adjustedDay, 0, 0, 0));
  }

  /**
   * Calcula a data de vencimento de uma fatura de cartão de crédito
   * Se o dueDay <= closingDay, o vencimento será no mês seguinte
   * @param closingDate - Data de fechamento da fatura
   * @param closingDay - Dia do fechamento (para comparação)
   * @param dueDay - Dia do vencimento
   * @returns Data de vencimento calculada
   */
  static calculateInvoiceDueDate(closingDate: Date, closingDay: number, dueDay: number): Date {
    const normalized = this.normalizeDate(closingDate);

    if (dueDay < 1 || dueDay > 31) {
      throw new BadRequestException('Dia de vencimento deve estar entre 1 e 31');
    }

    let year = normalized.getUTCFullYear();
    let month = normalized.getUTCMonth();

    // Se o dia de vencimento é menor ou igual ao dia de fechamento,
    // o vencimento deve ser no mês seguinte
    if (dueDay <= closingDay) {
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
    }

    // Obtém o último dia do mês para validação
    const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const adjustedDay = Math.min(dueDay, lastDayOfMonth);

    return new Date(Date.UTC(year, month, adjustedDay, 0, 0, 0));
  }

  /**
   * Obtém o mês anterior no formato YYYY-MM
   * @param yearMonth - Mês atual no formato YYYY-MM
   * @returns Mês anterior no formato YYYY-MM
   */
  static getPreviousMonth(yearMonth: string): string {
    const date = this.yearMonthToDate(yearMonth);
    const previousMonth = this.subtractMonths(date, 1);
    return this.getYearMonth(previousMonth);
  }

  /**
   * Obtém o próximo mês no formato YYYY-MM
   * @param yearMonth - Mês atual no formato YYYY-MM
   * @returns Próximo mês no formato YYYY-MM
   */
  static getNextMonth(yearMonth: string): string {
    const date = this.yearMonthToDate(yearMonth);
    const nextMonth = this.addMonths(date, 1);
    return this.getYearMonth(nextMonth);
  }

  /**
   * Extrai o dia de uma data
   * @param date - Data para extrair o dia
   * @returns Dia do mês (1-31)
   */
  static getDay(date: Date | string): number {
    const normalized = this.normalizeDate(date);
    return normalized.getUTCDate();
  }

  /**
   * Extrai uma string de data no formato ISO (YYYY-MM-DD)
   * @param date - Data para converter
   * @returns String no formato YYYY-MM-DD
   */
  static toISODateString(date: Date | string): string {
    const normalized = this.normalizeDate(date);
    const day = String(normalized.getUTCDate()).padStart(2, '0');
    const month = String(normalized.getUTCMonth() + 1).padStart(2, '0');
    const year = normalized.getUTCFullYear();
    return `${year}-${month}-${day}`;
  }

  /**
   * Formata uma data para exibição amigável
   * @param date - Data para formatar
   * @param formatString - Formato desejado (padrão: dd/MM/yyyy)
   * @returns String formatada
   */
  static format(date: Date | string, formatString: string = 'dd/MM/yyyy'): string {
    const normalized = this.normalizeDate(date);

    // Para evitar problemas com timezone, usamos métodos UTC nativos para formatação básica
    if (formatString === 'dd/MM/yyyy') {
      const day = String(normalized.getUTCDate()).padStart(2, '0');
      const month = String(normalized.getUTCMonth() + 1).padStart(2, '0');
      const year = normalized.getUTCFullYear();
      return `${day}/${month}/${year}`;
    }

    if (formatString === 'MM/yyyy') {
      const month = String(normalized.getUTCMonth() + 1).padStart(2, '0');
      const year = normalized.getUTCFullYear();
      return `${month}/${year}`;
    }

    if (formatString === 'yyyy-MM-dd') {
      const day = String(normalized.getUTCDate()).padStart(2, '0');
      const month = String(normalized.getUTCMonth() + 1).padStart(2, '0');
      const year = normalized.getUTCFullYear();
      return `${year}-${month}-${day}`;
    }

    // Para formatos não comuns, ajustamos o offset para usar date-fns corretamente
    const offsetInMinutes = normalized.getTimezoneOffset();
    const adjustedDate = new Date(normalized.getTime() + offsetInMinutes * 60 * 1000);
    return format(adjustedDate, formatString);
  }

  /**
   * Verifica se uma data está entre duas outras datas (inclusive)
   * @param date - Data a verificar
   * @param startDate - Data de início
   * @param endDate - Data de fim
   * @returns true se a data está no range
   */
  static isDateInRange(
    date: Date | string,
    startDate: Date | string,
    endDate: Date | string,
  ): boolean {
    const normalizedDate = this.normalizeDate(date);
    const normalizedStart = this.normalizeDate(startDate);
    const normalizedEnd = this.normalizeDate(endDate);

    return !isBefore(normalizedDate, normalizedStart) && !isAfter(normalizedDate, normalizedEnd);
  }

  /**
   * Encontra a data mínima entre várias datas
   * @param dates - Array de datas
   * @returns Data mínima
   */
  static min(...dates: (Date | string)[]): Date {
    const normalized = dates.map((d) => this.normalizeDate(d));
    return min(normalized);
  }

  /**
   * Encontra a data máxima entre várias datas
   * @param dates - Array de datas
   * @returns Data máxima
   */
  static max(...dates: (Date | string)[]): Date {
    const normalized = dates.map((d) => this.normalizeDate(d));
    return max(normalized);
  }

  /**
   * Valida se um ano é válido
   * @param year - Ano a validar
   * @throws BadRequestException se inválido
   */
  private static validateYear(year: number): void {
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      throw new BadRequestException('Ano deve estar entre 1900 e 2100');
    }
  }

  /**
   * Valida se um mês é válido
   * @param month - Mês a validar (1-12)
   * @throws BadRequestException se inválido
   */
  private static validateMonth(month: number): void {
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException('Mês deve estar entre 1 e 12');
    }
  }

  /**
   * Valida se um ano e mês são válidos
   * @param year - Ano a validar
   * @param month - Mês a validar
   * @throws BadRequestException se inválidos
   */
  private static validateYearMonth(year: number, month: number): void {
    this.validateYear(year);
    this.validateMonth(month);
  }

  /**
   * Verifica se uma string está no formato YYYY-MM válido
   * @param yearMonth - String a validar
   * @returns true se válido
   */
  private static isValidYearMonth(yearMonth: string): boolean {
    const regex = /^\d{4}-\d{2}$/;
    if (!regex.test(yearMonth)) return false;

    const [year, month] = yearMonth.split('-').map(Number);
    return year >= 1900 && year <= 2100 && month >= 1 && month <= 12;
  }

  // ==========================================
  // Métodos para Notificações (Cron Jobs)
  // ==========================================

  /**
   * Obtém a data de hoje normalizada em UTC (meia-noite UTC)
   * @returns Date representando hoje às 00:00:00 UTC
   */
  static getTodayUTC(): Date {
    const now = new Date();
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
    );
  }

  /**
   * Obtém uma data futura normalizada em UTC
   * @param daysAhead - Número de dias à frente
   * @returns Date representando o dia futuro às 00:00:00 UTC
   */
  static getFutureDateUTC(daysAhead: number): Date {
    const today = this.getTodayUTC();
    return new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() + daysAhead,
        0,
        0,
        0,
        0,
      ),
    );
  }

  /**
   * Obtém ontem normalizado em UTC (meia-noite UTC)
   * @returns Date representando ontem às 00:00:00 UTC
   */
  static getYesterdayUTC(): Date {
    return this.getFutureDateUTC(-1);
  }

  /**
   * Calcula a diferença em dias entre duas datas (sem considerar horário)
   * @param dateA - Primeira data
   * @param dateB - Segunda data
   * @returns Número de dias de diferença (positivo se dateA > dateB)
   */
  static calculateDaysDiff(dateA: Date | string, dateB: Date | string): number {
    const normalizedA = this.normalizeDate(dateA);
    const normalizedB = this.normalizeDate(dateB);
    return differenceInDays(normalizedA, normalizedB);
  }

  /**
   * Calcula quantos dias faltam até uma data futura
   * @param futureDate - Data futura
   * @returns Número de dias até a data (negativo se já passou)
   */
  static getDaysUntil(futureDate: Date | string): number {
    const normalized = this.normalizeDate(futureDate);
    const today = this.getTodayUTC();
    return differenceInDays(normalized, today);
  }

  /**
   * Calcula quantos dias se passaram desde uma data
   * @param pastDate - Data passada
   * @returns Número de dias desde a data (negativo se ainda não chegou)
   */
  static getDaysSince(pastDate: Date | string): number {
    const normalized = this.normalizeDate(pastDate);
    const today = this.getTodayUTC();
    return differenceInDays(today, normalized);
  }

  /**
   * Verifica se uma data está no futuro (após hoje)
   * @param date - Data a verificar
   * @returns true se a data está no futuro
   */
  static isFutureDate(date: Date | string): boolean {
    const normalized = this.normalizeDate(date);
    const today = this.getTodayUTC();
    return isAfter(normalized, today);
  }

  /**
   * Verifica se uma data está no passado (antes de hoje)
   * @param date - Data a verificar
   * @returns true se a data está no passado
   */
  static isPastDate(date: Date | string): boolean {
    const normalized = this.normalizeDate(date);
    const today = this.getTodayUTC();
    return isBefore(normalized, today);
  }

  /**
   * Verifica se uma data é hoje
   * @param date - Data a verificar
   * @returns true se a data é hoje
   */
  static isToday(date: Date | string): boolean {
    const normalized = this.normalizeDate(date);
    const today = this.getTodayUTC();
    return normalized.getTime() === today.getTime();
  }

  /**
   * Verifica se um mês/ano é futuro em relação ao mês/ano atual
   * @param yearMonth - String no formato YYYY-MM
   * @returns true se o mês é futuro
   */
  static isFutureMonth(yearMonth: string): boolean {
    const [year, month] = yearMonth.split('-').map(Number);
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth() + 1;

    return year > currentYear || (year === currentYear && month > currentMonth);
  }

  /**
   * Retorna a data de hoje em UTC
   * Alias para getTodayUTC()
   */
  static today(): Date {
    return this.getTodayUTC();
  }

  /**
   * Formata uma data para o formato brasileiro (dd/MM/yyyy)
   * @param date - Data para formatar
   * @returns String no formato dd/MM/yyyy
   */
  static formatBR(date: Date | string): string {
    return this.format(date, 'dd/MM/yyyy');
  }

  /**
   * Formata uma data para ISO (yyyy-MM-dd)
   * @param date - Data para formatar
   * @returns String no formato yyyy-MM-dd
   */
  static formatToISO(date: Date | string): string {
    return this.toISODateString(date);
  }

  /** 
   * Adiciona segundos a uma data PRESERVANDO a hora exata
   * NÃO normaliza para meia-noite - usa para cálculos de timeout/expiration
   */
  static addSeconds(date: Date | string, seconds: number): Date {
    let dateObj: Date;
    
    if (date instanceof Date) {
      dateObj = date;
    } else if (typeof date === 'string') {
      dateObj = parseISO(date);
      if (!isValid(dateObj)) {
        dateObj = new Date(date);
      }
    } else {
      dateObj = new Date(date);
    }
    
    if (!isValid(dateObj)) {
      throw new BadRequestException('Data inválida para addSeconds');
    }
    
    return addSeconds(dateObj, seconds);
  }
}

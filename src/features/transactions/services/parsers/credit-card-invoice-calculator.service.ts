import { Injectable, Logger } from '@nestjs/common';
import { addMonths, isAfter, parseISO, format } from 'date-fns';
import { GastoCertoApiService } from '@shared/gasto-certo-api.service';

export interface InvoiceMonthResult {
  invoiceMonth: string; // "2026-01" (YYYY-MM)
  invoiceMonthFormatted: string; // "Janeiro/2026"
  closingDate: Date; // Data de fechamento
  dueDate: Date; // Data de vencimento
  transactionDate: Date; // Data da transação
  isAfterClosing: boolean; // Se passou do fechamento
}

@Injectable()
export class CreditCardInvoiceCalculatorService {
  private readonly logger = new Logger(CreditCardInvoiceCalculatorService.name);

  constructor(private readonly gastoCertoApi: GastoCertoApiService) {}

  /**
   * Mapa de meses em português
   */
  private readonly MONTH_NAMES_PT: Record<number, string> = {
    0: 'Janeiro',
    1: 'Fevereiro',
    2: 'Março',
    3: 'Abril',
    4: 'Maio',
    5: 'Junho',
    6: 'Julho',
    7: 'Agosto',
    8: 'Setembro',
    9: 'Outubro',
    10: 'Novembro',
    11: 'Dezembro',
  };

  /**
   * Calcula para qual mês a fatura do cartão será lançada
   *
   * @param transactionDate - Data da transação (ISO string ou Date)
   * @param closingDay - Dia do mês em que a fatura fecha (ex: 10)
   * @param dueDay - Dia do mês em que a fatura vence (ex: 20)
   * @returns Informações sobre o mês da fatura
   */
  calculateInvoiceMonth(
    transactionDate: string | Date,
    closingDay: number = 10,
    dueDay: number = 20,
  ): InvoiceMonthResult {
    // Normalizar data da transação
    const txDate =
      typeof transactionDate === 'string' ? parseISO(transactionDate) : transactionDate;

    const txDay = txDate.getDate();
    const txMonth = txDate.getMonth();
    const txYear = txDate.getFullYear();

    // Data de fechamento da fatura do mês atual
    const currentMonthClosing = new Date(txYear, txMonth, closingDay);

    // Se a transação foi APÓS o fechamento, vai para o próximo mês
    const isAfterClosing = isAfter(txDate, currentMonthClosing);

    let invoiceDate: Date;
    if (isAfterClosing) {
      // Vai para a fatura do próximo mês
      invoiceDate = addMonths(currentMonthClosing, 1);
    } else {
      // Vai para a fatura do mês atual
      invoiceDate = currentMonthClosing;
    }

    // Data de vencimento (sempre depois do fechamento)
    const dueDateOfInvoice = new Date(invoiceDate.getFullYear(), invoiceDate.getMonth(), dueDay);

    // Formatar mês da fatura
    const invoiceMonth = format(invoiceDate, 'yyyy-MM');
    const monthName = this.MONTH_NAMES_PT[invoiceDate.getMonth()];
    const invoiceMonthFormatted = `${monthName}/${invoiceDate.getFullYear()}`;

    this.logger.log(
      `💳 Fatura calculada: Transação em ${format(txDate, 'dd/MM/yyyy')} ` +
        `→ Fatura de ${invoiceMonthFormatted} ` +
        `(Fechamento: ${format(invoiceDate, 'dd/MM/yyyy')})`,
    );

    return {
      invoiceMonth,
      invoiceMonthFormatted,
      closingDate: invoiceDate,
      dueDate: dueDateOfInvoice,
      transactionDate: txDate,
      isAfterClosing,
    };
  }

  /**
   * Busca dia de fechamento do cartão de crédito na API
   * Se não encontrar, usa padrão (dia 10)
   */
  async getCardClosingDay(accountId: string, creditCardId?: string): Promise<number> {
    if (!creditCardId) {
      this.logger.warn('⚠️ Nenhum cartão informado, usando dia de fechamento padrão (10)');
      return 10;
    }

    try {
      const result = await this.gastoCertoApi.listCreditCards(accountId);
      const card = result?.data?.find((c) => c.id === creditCardId);
      if (card?.closingDay) {
        this.logger.log(`📅 Dia de fechamento do cartão ${creditCardId}: ${card.closingDay}`);
        return card.closingDay;
      }
      this.logger.warn(`⚠️ Cartão ${creditCardId} não encontrado, usando dia padrão (10)`);
      return 10;
    } catch (error) {
      this.logger.error(`❌ Erro ao buscar dia de fechamento do cartão:`, error);
      return 10; // Fallback
    }
  }
}

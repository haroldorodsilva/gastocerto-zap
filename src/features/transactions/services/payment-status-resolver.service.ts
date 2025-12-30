import { Injectable, Logger } from '@nestjs/common';

export interface TransactionData {
  type: string;
  amount: number;
  description?: string | null;
  date?: string | null;
  category: string;
  subCategory?: string | null;
  merchant?: string | null;
  confidence: number;

  // Campos avançados
  isFixed?: boolean;
  fixedFrequency?: 'MONTHLY' | 'WEEKLY' | 'ANNUAL' | 'BIENNIAL';
  installments?: number;
  installmentNumber?: number;
  creditCardId?: string;
  paymentStatus?: 'PENDING' | 'DONE';
}

export interface PaymentStatusDecision {
  status: 'PENDING' | 'DONE';
  reason: string;
  shouldNotifyUser: boolean;
  notificationMessage?: string;
  requiresConfirmation: boolean; // Força confirmação
  invoiceMonth?: string; // Mês da fatura (YYYY-MM)
  invoiceMonthFormatted?: string; // Mês formatado (Janeiro/2026)
}

@Injectable()
export class PaymentStatusResolverService {
  private readonly logger = new Logger(PaymentStatusResolverService.name);

  /**
   * Determina o status de pagamento baseado no tipo de transação
   *
   * Regras:
   * 1. Transação FIXA → PENDING (requer confirmação mensal) + CONFIRMAÇÃO OBRIGATÓRIA
   * 2. Transação PARCELADA → PENDING (parcelas futuras não pagas ainda) + CONFIRMAÇÃO OBRIGATÓRIA
   * 3. Transação CARTÃO DE CRÉDITO → PENDING (fatura não foi paga ainda) + CONFIRMAÇÃO OBRIGATÓRIA
   * 4. Transação NORMAL → DONE (já foi realizada/paga)
   *
   * ⚠️ IMPORTANTE: Tipos 1, 2 e 3 SEMPRE exigem confirmação do usuário
   */
  resolvePaymentStatus(
    data: TransactionData,
    invoiceMonth?: string,
    invoiceMonthFormatted?: string,
  ): PaymentStatusDecision {
    // Regra 1: Transação Fixa
    if (data.isFixed) {
      return {
        status: 'PENDING',
        reason: 'Transação recorrente/fixa',
        shouldNotifyUser: true,
        requiresConfirmation: true, // ✨ SEMPRE exige confirmação
        notificationMessage: this.buildFixedNotification(data),
      };
    }

    // Regra 2: Transação Parcelada
    if (data.installments && data.installments > 1) {
      return {
        status: 'PENDING',
        reason: 'Transação parcelada',
        shouldNotifyUser: true,
        requiresConfirmation: true, // ✨ SEMPRE exige confirmação
        notificationMessage: this.buildInstallmentNotification(data),
      };
    }

    // Regra 3: Cartão de Crédito
    if (data.creditCardId) {
      return {
        status: 'PENDING',
        reason: 'Transação no cartão de crédito',
        shouldNotifyUser: true,
        requiresConfirmation: true, // ✨ SEMPRE exige confirmação
        notificationMessage: this.buildCreditCardNotification(data, invoiceMonthFormatted),
        invoiceMonth,
        invoiceMonthFormatted,
      };
    }

    // Regra 4: Transação Normal (padrão)
    return {
      status: 'DONE',
      reason: 'Transação normal/única já realizada',
      shouldNotifyUser: false,
      requiresConfirmation: false, // Depende da confidence
    };
  }

  /**
   * Monta notificação para transação fixa
   */
  private buildFixedNotification(data: TransactionData): string {
    const frequencyText = this.getFrequencyText(data.fixedFrequency);

    return (
      `\n\n🔁 *Transação Fixa Detectada*\n` +
      `Esta é uma transação recorrente (${frequencyText}).\n` +
      `Status: ⏳ *PENDENTE* (será cobrada ${frequencyText})`
    );
  }

  /**
   * Monta notificação para transação parcelada
   */
  private buildInstallmentNotification(data: TransactionData): string {
    const currentInstallment = data.installmentNumber || 1;
    const totalInstallments = data.installments!;
    const installmentValue = data.amount;

    return (
      `\n\n💳 *Transação Parcelada Detectada*\n` +
      `Parcela: ${currentInstallment}/${totalInstallments}\n` +
      `Valor da parcela: R$ ${installmentValue.toFixed(2)}\n` +
      `Valor total: R$ ${(installmentValue * totalInstallments).toFixed(2)}\n` +
      `Status: ⏳ *PENDENTE* (parcelas futuras a vencer)`
    );
  }

  /**
   * Monta notificação para cartão de crédito
   */
  private buildCreditCardNotification(data: TransactionData, invoiceMonth?: string): string {
    let message = `\n\n💳 *Transação no Cartão de Crédito*\n`;
    message += `Valor: R$ ${data.amount.toFixed(2)}\n`;

    if (invoiceMonth) {
      message += `📅 Fatura: ${invoiceMonth}\n`;
    }

    message += `Status: ⏳ *PENDENTE* (será cobrado na fatura)`;

    // Se também for parcelada
    if (data.installments && data.installments > 1) {
      message += `\n💳 ${data.installments}x de R$ ${(data.amount / data.installments).toFixed(2)}`;
    }

    // Se também for fixa
    if (data.isFixed) {
      const freq = this.getFrequencyText(data.fixedFrequency);
      message += `\n🔁 Cobrança recorrente (${freq})`;
    }

    return message;
  }

  /**
   * Converte frequência em texto legível
   */
  private getFrequencyText(frequency?: string): string {
    const map: Record<string, string> = {
      MONTHLY: 'mensalmente',
      WEEKLY: 'semanalmente',
      ANNUAL: 'anualmente',
      BIENNIAL: 'bienalmente',
    };

    return map[frequency || 'MONTHLY'] || 'mensalmente';
  }
}

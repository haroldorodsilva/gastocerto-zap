import { Injectable } from '@nestjs/common';
import { TransactionData } from '@infrastructure/ai/ai.interface';
import { DateUtil } from '../../../../utils/date.util';

/**
 * TransactionMessageFormatterService
 *
 * Responsável pela formatação de mensagens WhatsApp/Telegram
 * para o contexto de registro de transações.
 *
 * Extraído de TransactionRegistrationService para separar
 * lógica de apresentação da lógica de negócio.
 */
@Injectable()
export class TransactionMessageFormatterService {
  /**
   * Busca o nome de uma conta pelo ID na lista de contas do usuário.
   */
  findAccountName(accounts: unknown, accountId: string): string {
    if (!accounts || !Array.isArray(accounts) || !accountId) {
      return 'Conta não identificada';
    }

    const typedAccounts = accounts as Array<{
      id: string;
      name: string;
      type?: string;
      isPrimary?: boolean;
    }>;
    const account = typedAccounts.find((acc) => acc.id === accountId);
    return account?.name || 'Conta não identificada';
  }

  /**
   * Formata o perfil temporal para exibição amigável.
   */
  formatTemporalProfile(profile: string): string {
    const profiles: Record<string, string> = {
      TODAY: 'hoje',
      YESTERDAY: 'ontem',
      TOMORROW: 'amanhã',
      DAY_BEFORE_YESTERDAY: 'anteontem',
      LAST_WEEK: 'semana passada',
      THIS_WEEK: 'esta semana',
      NEXT_WEEK: 'próxima semana',
      LAST_MONTH: 'mês passado',
      THIS_MONTH: 'este mês',
      NEXT_MONTH: 'próximo mês',
    };
    return profiles[profile] || 'hoje';
  }

  /**
   * Formata erros de validação de forma amigável e humana.
   * Erros específicos recebem mensagens contextuais em vez de mensagens técnicas.
   */
  formatValidationError(errors: string[]): string {
    const hasAmountError = errors.some((e) =>
      e.toLowerCase().includes('valor') || e.toLowerCase().includes('zero'),
    );
    const hasCategoryError = errors.some((e) => e.toLowerCase().includes('categoria'));
    const hasTypeError = errors.some((e) => e.toLowerCase().includes('tipo'));

    if (hasAmountError) {
      return (
        '🤔 Não consegui identificar o *valor* na sua mensagem.\n\n' +
        'Pode repetir informando o valor? Exemplo:\n' +
        '_"Comprei medicamento por R$ 45,00 parcelado em 2x"_'
      );
    }

    if (hasCategoryError) {
      return (
        '🤔 Não consegui identificar a *categoria* da transação.\n\n' +
        'Pode detalhar um pouco mais? Exemplo:\n' +
        '_"Gastei R$ 50,00 com alimentação no mercado"_'
      );
    }

    if (hasTypeError) {
      return (
        '🤔 Não entendi se foi uma *entrada* ou *saída*.\n\n' +
        'Pode informar com mais clareza? Exemplo:\n' +
        '_"Gastei R$ 30,00 no almoço"_ ou _"Recebi R$ 500,00 de freela"_'
      );
    }

    // Fallback genérico — mas ainda amigável
    return (
      '🤔 Não consegui entender completamente sua mensagem.\n\n' +
      'Pode tentar de outra forma? Exemplo:\n' +
      '_"Gastei R$ 50,00 em alimentação no mercado"_'
    );
  }

  /**
   * Formata mensagem de sucesso de registro de transação.
   */
  formatSuccessMessage(params: {
    type: string;
    amount: number;
    amountInCents?: boolean;
    category: string;
    subCategory?: string | null;
    description?: string | null;
    date: Date | string;
    temporalProfile?: string;
    accountName: string;
    creditCardName?: string;
    installments?: number;
    installmentValueType?: 'INSTALLMENT_VALUE' | 'GROSS_VALUE';
    invoiceMonth?: string;
    isFixed?: boolean;
    fixedFrequency?: string;
  }): string {
    const typeEmoji = params.type === 'EXPENSES' ? '💸' : '💰';
    const subCategoryText = params.subCategory ? ` > ${params.subCategory}` : '';

    const displayAmount = params.amountInCents
      ? (Number(params.amount) / 100).toFixed(2)
      : Number(params.amount).toFixed(2);

    const transactionDate = typeof params.date === 'string' ? new Date(params.date) : params.date;
    const formattedDate = transactionDate.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });

    const temporalText = this.formatTemporalProfile(params.temporalProfile || 'TODAY');

    // Informações extras: cartão e parcelamento
    let extraInfo = '';
    if (params.creditCardName) {
      extraInfo += `\n💳 *Cartão:* ${params.creditCardName}`;
    }
    if (params.invoiceMonth) {
      const [yyyy, mm] = params.invoiceMonth.split('-');
      const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
      const monthName = months[parseInt(mm, 10) - 1] || mm;
      extraInfo += `\n📆 *Fatura:* ${monthName}/${yyyy}`;
    }
    if (params.installments && params.installments > 1) {
      const totalAmt = params.amountInCents ? Number(params.amount) / 100 : Number(params.amount);
      const perInstallment = params.installmentValueType === 'INSTALLMENT_VALUE'
        ? totalAmt
        : totalAmt / params.installments;
      const totalValue = params.installmentValueType === 'INSTALLMENT_VALUE'
        ? totalAmt * params.installments
        : totalAmt;
      extraInfo += `\n🔀 *Parcelado:* ${params.installments}x de R$ ${perInstallment.toFixed(2)}`;
      extraInfo += `\n💰 *Total:* R$ ${totalValue.toFixed(2)}`;
    }
    if (params.isFixed && params.fixedFrequency) {
      const freqMap: Record<string, string> = { MONTHLY: 'Mensal', WEEKLY: 'Semanal', ANNUAL: 'Anual', BIENNIAL: 'Bienal' };
      extraInfo += `\n🔄 *Recorrência:* ${freqMap[params.fixedFrequency] || params.fixedFrequency}`;
    }

    return (
      `${typeEmoji} *Transação registrada com sucesso!*\n\n` +
      `💵 *Valor:* R$ ${displayAmount}\n` +
      `📂 *Categoria:* ${params.category}${subCategoryText}\n` +
      `${params.description ? `📝 ${params.description}\n` : ''}` +
      `📅 *Data:* ${formattedDate} (${temporalText})\n` +
      (extraInfo ? extraInfo + '\n' : '') +
      `👤 *Perfil:* ${params.accountName}`
    );
  }

  /**
   * Formata mensagem de erro de registro de transação.
   */
  formatErrorMessage(error?: string): string {
    return (
      '❌ *Erro ao registrar transação*\n\n' +
      (error || 'Erro desconhecido') +
      '\n\n_Por favor, tente novamente mais tarde._'
    );
  }

  /**
   * Formata mensagem de confirmação (requer sim/não do usuário).
   */
  formatConfirmationMessage(params: {
    data: TransactionData;
    validDate: Date;
    accountName: string;
  }): string {
    const { data, validDate, accountName } = params;

    const typeEmoji = data.type === 'EXPENSES' ? '💸' : '💰';
    const typeText = data.type === 'EXPENSES' ? 'Gasto' : 'Receita';

    // Formatar categoria com subcategoria
    const categoryText = data.subCategory
      ? `${data.category} > ${data.subCategory}`
      : `${data.category}\n📂 *Subcategoria:* Não encontrada`;

    // Informações adicionais para transações especiais
    let additionalInfo = '';

    // Transação parcelada
    if (data.installments && data.installments > 1) {
      const isInstallmentValue = (data as any).installmentValueType === 'INSTALLMENT_VALUE';
      const installmentValue = isInstallmentValue ? data.amount : data.amount / data.installments;
      const totalValue = isInstallmentValue ? data.amount * data.installments : data.amount;
      additionalInfo += `\n💳 *Parcelamento:* ${data.installments}x de R$ ${installmentValue.toFixed(2)}`;
      additionalInfo += `\n💰 *Valor total:* R$ ${totalValue.toFixed(2)}`;
      if (data.installmentNumber) {
        additionalInfo += ` (parcela ${data.installmentNumber}/${data.installments})`;
      }
    }

    // Transação fixa/recorrente
    if (data.isFixed && data.fixedFrequency) {
      const frequencyMap: Record<string, string> = {
        MONTHLY: 'Mensal',
        WEEKLY: 'Semanal',
        ANNUAL: 'Anual',
        BIENNIAL: 'Bienal',
      };
      additionalInfo += `\n🔄 *Recorrência:* ${frequencyMap[data.fixedFrequency] || data.fixedFrequency}`;
    }

    // Transação no cartão de crédito
    if ((data as any).creditCardId && data.invoiceMonth) {
      const cardDisplayName = (data as any).creditCardName;
      additionalInfo += cardDisplayName ? `\n💳 *Cartão:* ${cardDisplayName}` : `\n💳 *Cartão de Crédito*`;
      const [yyyy, mm] = data.invoiceMonth.split('-');
      const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
      const monthName = months[parseInt(mm, 10) - 1] || mm;
      additionalInfo += `\n📆 *Fatura:* ${monthName}/${yyyy}`;
    }

    // Status do pagamento
    if (data.paymentStatus === 'PENDING') {
      additionalInfo += `\n⏳ *Status:* Pendente`;
    }

    return (
      `${typeEmoji} *Confirmar ${typeText}?*\n\n` +
      `💵 *Valor:* R$ ${data.amount.toFixed(2)}\n` +
      `📂 *Categoria:* ${categoryText}\n` +
      `${data.description ? `📝 *Descrição:* ${data.description}\n` : ''}` +
      `${data.date ? `📅 *Data:* ${DateUtil.formatBR(validDate)}\n` : ''}` +
      `${data.merchant ? `🏪 *Local:* ${data.merchant}\n` : ''}` +
      `👤 *Perfil:* ${accountName}` +
      additionalInfo +
      `\n\n✅ Digite *"sim"* para confirmar\n` +
      `❌ Digite *"não"* para cancelar\n` +
      `🔄 Digite *"trocar"* para mudar a categoria`
    );
  }

  /**
   * Extrai perfil temporal do extractedData de uma confirmação.
   */
  extractTemporalText(extractedData: unknown): string {
    try {
      const parsed = typeof extractedData === 'string' ? JSON.parse(extractedData) : extractedData;
      const temporalProfile = parsed?.temporalInfo?.profile || 'TODAY';
      return this.formatTemporalProfile(temporalProfile);
    } catch {
      return 'hoje';
    }
  }
}

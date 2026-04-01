import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';
import { GastoCertoApiService } from '@shared/gasto-certo-api.service';
import { UserCacheService } from '@features/users/user-cache.service';
import { CreditCardInvoiceCalculatorService } from '@features/transactions/services/parsers/credit-card-invoice-calculator.service';
import { CreateGastoCertoTransactionDto } from '@features/transactions/dto/transaction.dto';

/**
 * RecurringTransactionService
 *
 * Responsável por criar parcelas adicionais e ocorrências recorrentes
 * quando o usuário confirma uma transação parcelada ou fixa.
 *
 * Extraído do TransactionRegistrationService para reduzir complexidade.
 */
@Injectable()
export class RecurringTransactionService {
  private readonly logger = new Logger(RecurringTransactionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gastoCertoApi: GastoCertoApiService,
    private readonly userCache: UserCacheService,
    private readonly invoiceCalculator: CreditCardInvoiceCalculatorService,
  ) {}

  /**
   * 📦 Cria próximas ocorrências para transações fixas/recorrentes
   *
   * Quando o usuário confirma uma transação fixa (ex: assinatura mensal), este método:
   * 1. Determina a frequência (MONTHLY, WEEKLY, ANNUAL, BIENNIAL)
   * 2. Calcula as próximas N datas baseado na frequência
   * 3. Cria transações futuras na API
   * 4. Limite padrão: 6 meses (ou 12 semanas se semanal)
   */
  async createRecurringOccurrences(confirmation: any): Promise<void> {
    try {
      const frequency = confirmation.fixedFrequency;
      const occurrencesLimit = this.getOccurrencesLimit(frequency);

      this.logger.log(
        `🔄 [RECURRING] Criando ocorrências futuras: ${occurrencesLimit} ocorrências (${frequency})`,
      );

      // Buscar usuário
      const user = await this.userCache.getUser(confirmation.phoneNumber);
      if (!user) {
        this.logger.warn(`⚠️ [RECURRING] Usuário não encontrado: ${confirmation.phoneNumber}`);
        return;
      }

      // Usar accountId da confirmação
      const accountId = confirmation.accountId;
      if (!accountId) {
        this.logger.warn(`⚠️ [RECURRING] Confirmação sem accountId`);
        return;
      }

      // Data base da primeira ocorrência
      const baseDate = new Date(confirmation.date);

      // Criar próximas ocorrências
      const occurrencesToCreate = [];
      for (let i = 1; i <= occurrencesLimit; i++) {
        const occurrenceDate = this.calculateNextOccurrenceDate(baseDate, frequency, i);
        occurrencesToCreate.push({
          occurrenceNumber: i + 1, // +1 porque a primeira já foi criada
          date: occurrenceDate,
        });
      }

      // Criar cada ocorrência na API
      for (const occurrence of occurrencesToCreate) {
        const dto: CreateGastoCertoTransactionDto = {
          userId: user.gastoCertoId,
          accountId,
          categoryId: confirmation.categoryId,
          subCategoryId: confirmation.subCategoryId || undefined,
          type: confirmation.type,
          amount: confirmation.amount,
          description: confirmation.description
            ? `${confirmation.description} (${this.formatFrequency(frequency)})`
            : `Recorrência ${this.formatFrequency(frequency)}`,
          dueDate: occurrence.date.toISOString().split('T')[0], // YYYY-MM-DD
          source: confirmation.platform || 'whatsapp',
        };

        try {
          await this.gastoCertoApi.createTransaction(dto);
          this.logger.log(
            `✅ [RECURRING] Ocorrência ${occurrence.occurrenceNumber} criada: ${occurrence.date.toISOString().split('T')[0]}`,
          );

          // Salvar no banco para rastreamento
          await this.prisma.transactionConfirmation.create({
            data: {
              phoneNumber: confirmation.phoneNumber,
              platform: confirmation.platform || 'whatsapp',
              messageId: `${confirmation.messageId}_recurring_${occurrence.occurrenceNumber}`,
              type: confirmation.type,
              amount: confirmation.amount,
              category: confirmation.category,
              categoryId: confirmation.categoryId,
              subCategoryId: confirmation.subCategoryId,
              subCategoryName: confirmation.subCategoryName,
              description: dto.description,
              date: occurrence.date,
              extractedData: confirmation.extractedData,
              confirmedAt: new Date(),
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
              apiSent: true,
              apiSentAt: new Date(),
              isFixed: true,
              fixedFrequency: frequency,
              paymentStatus: 'PENDING',
            },
          });
        } catch (error) {
          this.logger.error(
            `❌ [RECURRING] Erro ao criar ocorrência ${occurrence.occurrenceNumber}:`,
            error,
          );
          // Continua criando as outras ocorrências mesmo se uma falhar
        }
      }

      this.logger.log(
        `✅ [RECURRING] Processo concluído: ${occurrencesToCreate.length} ocorrências criadas`,
      );
    } catch (error) {
      this.logger.error(`❌ [RECURRING] Erro ao criar ocorrências recorrentes:`, error);
      // Não propaga erro para não bloquear confirmação principal
    }
  }

  /**
   * 📦 Cria parcelas adicionais para transações parceladas
   *
   * Quando o usuário confirma uma transação parcelada (ex: 4x), este método:
   * 1. Calcula as datas das próximas parcelas (incrementa mês a mês)
   * 2. Cria N-1 transações adicionais na API (primeira já foi criada)
   * 3. Cada parcela tem seu próprio installmentNumber (2/4, 3/4, 4/4)
   * 4. Se for cartão, calcula o mês da fatura para cada parcela
   */
  async createAdditionalInstallments(confirmation: any): Promise<void> {
    try {
      const totalInstallments = confirmation.installments;
      const currentInstallmentNumber = confirmation.installmentNumber || 1;

      this.logger.log(
        `📦 [INSTALLMENTS] Criando parcelas adicionais: ${totalInstallments - currentInstallmentNumber} restantes`,
      );

      // Buscar usuário
      const user = await this.userCache.getUser(confirmation.phoneNumber);
      if (!user) {
        this.logger.warn(`⚠️ [INSTALLMENTS] Usuário não encontrado: ${confirmation.phoneNumber}`);
        return;
      }

      // Usar accountId da confirmação
      const accountId = confirmation.accountId;
      if (!accountId) {
        this.logger.warn(`⚠️ [INSTALLMENTS] Confirmação sem accountId`);
        return;
      }

      // Data base da primeira parcela
      const baseDate = new Date(confirmation.date);

      // Criar parcelas restantes (de installmentNumber+1 até totalInstallments)
      const installmentsToCreate = [];
      for (let i = currentInstallmentNumber + 1; i <= totalInstallments; i++) {
        // Calcular data da parcela (adiciona meses)
        const installmentDate = new Date(baseDate);
        installmentDate.setMonth(baseDate.getMonth() + (i - currentInstallmentNumber));

        // Calcular mês da fatura se for cartão
        let invoiceMonth: string | undefined;
        let invoiceMonthFormatted: string | undefined;
        if (confirmation.creditCardId) {
          const closingDay = await this.invoiceCalculator.getCardClosingDay(
            user.gastoCertoId,
            confirmation.creditCardId,
          );
          const invoiceResult = this.invoiceCalculator.calculateInvoiceMonth(
            installmentDate,
            closingDay,
          );
          invoiceMonth = invoiceResult.invoiceMonth;
          invoiceMonthFormatted = invoiceResult.invoiceMonthFormatted;
        }

        installmentsToCreate.push({
          installmentNumber: i,
          date: installmentDate,
          invoiceMonth,
          invoiceMonthFormatted,
        });
      }

      // Criar cada parcela na API
      for (const installment of installmentsToCreate) {
        const dto: CreateGastoCertoTransactionDto = {
          userId: user.gastoCertoId,
          accountId,
          categoryId: confirmation.categoryId,
          subCategoryId: confirmation.subCategoryId || undefined,
          type: confirmation.type,
          amount: confirmation.amount,
          description: confirmation.description
            ? `${confirmation.description} (${installment.installmentNumber}/${totalInstallments})`
            : `Parcela ${installment.installmentNumber}/${totalInstallments}`,
          dueDate: installment.date.toISOString().split('T')[0],
          source: confirmation.platform || 'whatsapp',
        };

        try {
          await this.gastoCertoApi.createTransaction(dto);
          this.logger.log(
            `✅ [INSTALLMENTS] Parcela ${installment.installmentNumber}/${totalInstallments} criada com sucesso`,
          );

          await this.prisma.transactionConfirmation.create({
            data: {
              phoneNumber: confirmation.phoneNumber,
              platform: confirmation.platform || 'whatsapp',
              messageId: `${confirmation.messageId}_installment_${installment.installmentNumber}`,
              type: confirmation.type,
              amount: confirmation.amount,
              category: confirmation.category,
              categoryId: confirmation.categoryId,
              subCategoryId: confirmation.subCategoryId,
              subCategoryName: confirmation.subCategoryName,
              description: dto.description,
              date: installment.date,
              extractedData: confirmation.extractedData,
              confirmedAt: new Date(),
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
              apiSent: true,
              apiSentAt: new Date(),
              installments: totalInstallments,
              installmentNumber: installment.installmentNumber,
              creditCardId: confirmation.creditCardId,
              invoiceMonth: installment.invoiceMonth,
              paymentStatus: 'PENDING',
            },
          });
        } catch (error) {
          this.logger.error(
            `❌ [INSTALLMENTS] Erro ao criar parcela ${installment.installmentNumber}/${totalInstallments}:`,
            error,
          );
          // Continua criando as outras parcelas mesmo se uma falhar
        }
      }

      this.logger.log(
        `✅ [INSTALLMENTS] Processo concluído: ${installmentsToCreate.length} parcelas criadas`,
      );
    } catch (error) {
      this.logger.error(`❌ [INSTALLMENTS] Erro ao criar parcelas adicionais:`, error);
      // Não propaga erro para não bloquear confirmação principal
    }
  }

  /**
   * Determina quantas ocorrências futuras criar baseado na frequência
   */
  getOccurrencesLimit(frequency: string): number {
    switch (frequency) {
      case 'WEEKLY':
        return 12;
      case 'MONTHLY':
        return 6;
      case 'ANNUAL':
        return 2;
      case 'BIENNIAL':
        return 1;
      default:
        return 6;
    }
  }

  /**
   * Calcula a data da próxima ocorrência baseado na frequência
   */
  calculateNextOccurrenceDate(baseDate: Date, frequency: string, incrementCount: number): Date {
    const nextDate = new Date(baseDate);

    switch (frequency) {
      case 'WEEKLY':
        nextDate.setDate(baseDate.getDate() + incrementCount * 7);
        break;
      case 'MONTHLY':
        nextDate.setMonth(baseDate.getMonth() + incrementCount);
        break;
      case 'ANNUAL':
        nextDate.setFullYear(baseDate.getFullYear() + incrementCount);
        break;
      case 'BIENNIAL':
        nextDate.setFullYear(baseDate.getFullYear() + incrementCount * 2);
        break;
    }

    return nextDate;
  }

  /**
   * Formata a frequência para exibição
   */
  formatFrequency(frequency: string): string {
    const frequencyMap: Record<string, string> = {
      WEEKLY: 'Semanal',
      MONTHLY: 'Mensal',
      ANNUAL: 'Anual',
      BIENNIAL: 'Bienal',
    };
    return frequencyMap[frequency] || frequency;
  }
}

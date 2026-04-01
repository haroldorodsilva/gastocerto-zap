import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';
import { GastoCertoApiService } from '@shared/gasto-certo-api.service';
import { UserCacheService } from '../../../users/user-cache.service';
import { TransactionConfirmationService } from '../../transaction-confirmation.service';
import { RecurringTransactionService } from '../../services/recurring-transaction.service';
import { CategoryResolverService } from '../../services/category-resolver.service';
import { TransactionMessageFormatterService } from './transaction-message-formatter.service';
import { TransactionData, TransactionType } from '@infrastructure/ai/ai.interface';
import { CreateGastoCertoTransactionDto } from '../../dto/transaction.dto';
import { DateUtil } from '../../../../utils/date.util';

/**
 * TransactionApiSenderService
 *
 * Responsável pela comunicação com a API GastoCerto:
 * - Enviar transações confirmadas
 * - Reenviar transações falhadas
 * - Gerenciar status de envio (apiSent, apiError, retryCount)
 * - Criar parcelas/recorrências após envio bem-sucedido
 *
 * Extraído de TransactionRegistrationService para separar
 * lógica de API da lógica de extração/confirmação.
 */
@Injectable()
export class TransactionApiSenderService {
  private readonly logger = new Logger(TransactionApiSenderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gastoCertoApi: GastoCertoApiService,
    private readonly userCache: UserCacheService,
    private readonly confirmationService: TransactionConfirmationService,
    private readonly recurringService: RecurringTransactionService,
    private readonly categoryResolver: CategoryResolverService,
    private readonly messageFormatter: TransactionMessageFormatterService,
  ) {}

  /**
   * Método genérico para enviar transação para API GastoCerto.
   * Consolida a lógica de envio usada em todos os fluxos.
   */
  async sendTransactionToApi(
    confirmation: any,
    data?: TransactionData,
  ): Promise<{
    success: boolean;
    error?: string;
    transactionId?: string;
  }> {
    try {
      // 1. Buscar usuário
      const user = await this.userCache.getUser(confirmation.phoneNumber);
      if (!user) {
        return { success: false, error: 'Usuário não encontrado' };
      }

      // 2. Buscar conta da transação
      let activeAccount;

      if (confirmation.accountId) {
        this.logger.log(`📌 Usando conta salva na confirmação: ${confirmation.accountId}`);
        const userCache = await this.userCache.getUser(confirmation.phoneNumber);
        if (userCache?.accounts && Array.isArray(userCache.accounts)) {
          activeAccount = (userCache.accounts as any[]).find(
            (acc: any) => acc.id === confirmation.accountId,
          );
        }
      } else {
        this.logger.log(`⚠️ Confirmação sem accountId, buscando conta ativa atual`);
        activeAccount = await this.userCache.getActiveAccount(confirmation.phoneNumber);
      }

      if (!activeAccount) {
        this.logger.warn(`⚠️ Conta não encontrada para usuário ${user.gastoCertoId}`);
        return {
          success: false,
          error: 'Conta não encontrada. Use "minhas contas" para configurar.',
        };
      }

      const accountId = activeAccount.id;
      this.logger.log(`✅ Usando conta: ${activeAccount.name} (${accountId})`);

      // 3. Resolver IDs de categoria e subcategoria
      let categoryId: string | null = null;
      let subCategoryId: string | null = null;

      if (confirmation.categoryId) {
        categoryId = confirmation.categoryId;
        subCategoryId = confirmation.subCategoryId || null;
        this.logger.log(
          `📂 Usando IDs salvos: categoryId=${categoryId}, subCategoryId=${subCategoryId || 'null'}`,
        );
      } else {
        this.logger.log(
          `🔍 Confirmação sem categoryId, resolvendo pelo nome (tipo: ${confirmation.type})...`,
        );
        const resolved = await this.categoryResolver.resolve(
          user.gastoCertoId,
          accountId,
          confirmation.category,
          confirmation.extractedData?.subcategory || data?.subCategory,
          confirmation.type,
        );
        categoryId = resolved.categoryId;
        subCategoryId = resolved.subCategoryId;
      }

      if (!categoryId) {
        return { success: false, error: 'Categoria não encontrada' };
      }

      // 4. Preparar DTO para API
      const description =
        confirmation.description || data?.description || confirmation.extractedData?.description;
      const merchant = confirmation.extractedData?.merchant || data?.merchant;

      // Palavras que indicam apenas forma de pagamento — não são descrições úteis
      const PAYMENT_METHOD_TOKENS = /^(carta[o\u00e3]s?|cr[eé]dito|d[eé]bito|pix|dinheiro|cart[a\u00e3]o\s+de\s+cr[eé]dito)$/i;
      const rawDescription = description?.trim();
      const isPaymentMethodOnly = rawDescription ? PAYMENT_METHOD_TOKENS.test(rawDescription) : false;

      // API exige description não vazio - usar subcategoria ou categoria como fallback
      // Também ignora descrições que são apenas forma de pagamento (ex: "cartão", "cartã", "pix")
      let descriptionValue =
        (rawDescription && !isPaymentMethodOnly) ? rawDescription
        : (confirmation.subCategoryName && confirmation.subCategoryName.trim()) ? confirmation.subCategoryName.trim()
        : (confirmation.category && confirmation.category.trim()) ? confirmation.category.trim()
        : 'Transação';

      // Incluir nome do estabelecimento na descrição
      if (merchant && merchant.trim()) {
        descriptionValue = `${descriptionValue} - ${merchant.trim()}`;
      }

      const isCreditCard = !!confirmation.creditCardId;

      const dto: CreateGastoCertoTransactionDto = {
        userId: user.gastoCertoId,
        accountId,
        type: confirmation.type as TransactionType,
        amount: Number(confirmation.amount),
        categoryId,
        subCategoryId,
        description: descriptionValue,
        dueDate: confirmation.date
          ? DateUtil.formatToISO(DateUtil.normalizeDate(confirmation.date))
          : DateUtil.formatToISO(DateUtil.today()),
        isCreditCard,
        ...(confirmation.installments && confirmation.installments > 1 ? {
          installments: confirmation.installments,
          installmentType: (confirmation.installmentValueType as 'INSTALLMENT_VALUE' | 'GROSS_VALUE') || 'GROSS_VALUE',
        } : {}),
        ...(confirmation.isFixed ? { isFixed: true } : {}),
        source: confirmation.platform || 'telegram',
      };

      this.logger.log(`📤 Enviando para GastoCerto API:`, JSON.stringify(dto, null, 2));

      // 5. Registrar na API
      const response = await this.gastoCertoApi.createTransaction(dto);

      if (response.success) {
        return {
          success: true,
          transactionId: response.transaction?.id || 'unknown',
        };
      } else {
        this.logger.error(
          `❌ [API ERROR] Erro ao enviar transação para GastoCerto API:`,
          JSON.stringify(response, null, 2),
        );
        const errorMsg =
          typeof response.error === 'string'
            ? response.error
            : response.error?.message || 'Erro desconhecido na API';
        return { success: false, error: errorMsg };
      }
    } catch (error: any) {
      this.logger.error(
        `❌ [EXCEPTION] Exceção ao enviar transação:`,
        JSON.stringify(
          {
            message: error.message,
            stack: error.stack,
            name: error.name,
            response: error.response?.data || error.response,
          },
          null,
          2,
        ),
      );
      return {
        success: false,
        error: error.message || 'Erro ao enviar transação',
      };
    }
  }

  /**
   * Método específico para retry job — retorna transactionId.
   * Usado pelo ApiRetryJob para reenviar transações falhadas.
   */
  async sendConfirmedTransactionToApi(confirmation: any): Promise<{
    success: boolean;
    error?: string;
    transactionId?: string;
  }> {
    return await this.sendTransactionToApi(confirmation);
  }

  /**
   * Registra transação confirmada pelo usuário na API GastoCerto.
   * Atualiza banco, cria parcelas/recorrências, formata mensagem de resultado.
   */
  async registerConfirmedTransaction(
    confirmation: any,
  ): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.log(`💾 [Registration] Registrando transação confirmada ID: ${confirmation.id}`);

      const result = await this.sendTransactionToApi(confirmation);

      if (result.success) {
        // Atualizar banco: marcar como enviado
        await this.prisma.transactionConfirmation.update({
          where: { id: confirmation.id },
          data: {
            apiSent: true,
            apiSentAt: new Date(),
            apiError: null,
          },
        });
        this.logger.log(`✅ Confirmação ${confirmation.id} marcada como enviada`);

        // NOTA: Parcelas (installments) são criadas automaticamente pela API
        // quando installments + installmentType são enviados no DTO.
        // NÃO criar parcelas adicionais aqui para evitar duplicação.

        // NOTA: Transações fixas/recorrentes são criadas automaticamente pela API
        // quando isFixed: true é enviado no DTO (via FixedTransactionsService).
        // NÃO criar ocorrências adicionais aqui para evitar duplicação.

        // Buscar nome da conta
        const accountName = confirmation.accountId
          ? await this.resolveAccountName(confirmation.phoneNumber, confirmation.accountId)
          : 'Conta não identificada';

        // Extrair perfil temporal
        const temporalText = this.messageFormatter.extractTemporalText(confirmation.extractedData);

        // Extrair campos extras do extractedData
        let parsedExtracted: any = {};
        try {
          parsedExtracted = typeof confirmation.extractedData === 'string'
            ? JSON.parse(confirmation.extractedData as string)
            : (confirmation.extractedData || {});
        } catch { /* ignore */ }

        const successMessage = this.messageFormatter.formatSuccessMessage({
          type: confirmation.type,
          amount: confirmation.amount,
          amountInCents: true,
          category: confirmation.category,
          subCategory: confirmation.subCategoryName,
          description: confirmation.description,
          date: confirmation.date,
          temporalProfile: temporalText === 'hoje' ? 'TODAY' : undefined,
          accountName,
          creditCardName: parsedExtracted.creditCardName,
          installments: confirmation.installments ?? undefined,
          installmentValueType: parsedExtracted.installmentValueType,
          invoiceMonth: confirmation.invoiceMonth ?? undefined,
          isFixed: confirmation.isFixed ?? false,
          fixedFrequency: confirmation.fixedFrequency ?? undefined,
        });

        return { success: true, message: successMessage };
      } else {
        // Atualizar banco: marcar erro
        await this.prisma.transactionConfirmation.update({
          where: { id: confirmation.id },
          data: {
            apiRetryCount: { increment: 1 },
            apiError: result.error || 'Erro desconhecido',
          },
        });
        this.logger.error(`❌ Erro na API GastoCerto:`, result.error);

        return {
          success: false,
          message: this.messageFormatter.formatErrorMessage(result.error),
        };
      }
    } catch (error: any) {
      this.logger.error('❌ Erro ao registrar transação confirmada:', error);
      return {
        success: false,
        message: '❌ Erro ao registrar transação. Tente novamente.',
      };
    }
  }

  /**
   * Reenvia uma transação pendente usando dados salvos.
   * Usado pelo endpoint de reenvio manual.
   */
  async resendTransaction(
    confirmationId: string,
  ): Promise<{ success: boolean; error?: string; transactionId?: string }> {
    try {
      this.logger.log(`🔄 Reenviando transação: ${confirmationId}`);

      const confirmation = await this.confirmationService.getById(confirmationId);
      if (!confirmation) {
        return { success: false, error: 'Confirmação não encontrada' };
      }

      if (confirmation.apiSent) {
        this.logger.warn(`⚠️ Transação ${confirmationId} já foi enviada`);
        return { success: true };
      }

      const result = await this.sendTransactionToApi(confirmation);

      if (result.success) {
        await this.prisma.transactionConfirmation.update({
          where: { id: confirmationId },
          data: {
            apiSent: true,
            apiSentAt: new Date(),
            apiError: null,
          },
        });
        this.logger.log(`✅ Transação ${confirmationId} reenviada com sucesso`);
      } else {
        await this.prisma.transactionConfirmation.update({
          where: { id: confirmationId },
          data: {
            apiRetryCount: { increment: 1 },
            apiError: result.error,
          },
        });
        this.logger.error(`❌ Erro ao reenviar ${confirmationId}: ${result.error}`);
      }

      return result;
    } catch (error: any) {
      this.logger.error(`❌ Erro no reenvio da transação ${confirmationId}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Helper: resolve o nome da conta a partir do cache do usuário.
   */
  private async resolveAccountName(phoneNumber: string, accountId: string): Promise<string> {
    const userCache = await this.userCache.getUser(phoneNumber);
    return this.messageFormatter.findAccountName(userCache?.accounts, accountId);
  }
}

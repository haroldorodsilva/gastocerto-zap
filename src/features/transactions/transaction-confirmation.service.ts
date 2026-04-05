import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@core/database/prisma.service';
import { PlatformReplyService } from '@infrastructure/messaging/messages/platform-reply.service';
import { TransactionConfirmation, ConfirmationStatus } from '@prisma/client';
import { MessageSanitizerUtil } from '@core/utils/message-sanitizer.util';
import { CreateTransactionConfirmationDto } from './dto/transaction.dto';
import { DateUtil } from '../../utils/date.util';

@Injectable()
export class TransactionConfirmationService {
  private readonly logger = new Logger(TransactionConfirmationService.name);
  private readonly timeoutSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly platformReply: PlatformReplyService,
  ) {
    this.timeoutSeconds = this.configService.get<number>('CONFIRMATION_TIMEOUT_SECONDS', 300);
    this.logger.log(`⏱️  Timeout de confirmação configurado: ${this.timeoutSeconds}s`);
  }

  /**
   * Helper para emitir eventos de resposta para a plataforma correta
   */
  private async emitReply(platformId: string, message: string, context: string, metadata?: any): Promise<void> {
    await this.platformReply.sendReply({
      platformId,
      message,
      context,
      metadata,
    });
  }

  /**
   * Cria nova confirmação pendente
   */
  async create(dto: CreateTransactionConfirmationDto): Promise<TransactionConfirmation> {
    try {
      // Normalizar data usando DateUtil
      let transactionDate: Date;
      try {
        transactionDate = dto.date ? DateUtil.normalizeDate(dto.date) : DateUtil.today();
      } catch (error) {
        this.logger.warn(`⚠️  Data inválida recebida: ${dto.date}, usando data atual`);
        this.logger.error(`⚠️  Data inválida recebida:`, error);
        transactionDate = DateUtil.today();
      }

      this.logger.log(`\n📋 ========== CRIANDO CONFIRMAÇÃO ==========`);
      this.logger.log(`📞 Phone: ${dto.phoneNumber}`);
      this.logger.log(`📨 Message ID: ${dto.messageId}`);
      this.logger.log(`💰 Type: ${dto.type} | Amount: ${dto.amount}`);
      this.logger.log(`📂 Category: ${dto.category}`);
      this.logger.log(`📝 Description: ${dto.description || 'N/A'}`);
      this.logger.log(
        `📅 Date: ${DateUtil.formatBR(transactionDate)} (ISO: ${DateUtil.toISODateString(transactionDate)})`,
      );
      this.logger.log(`⏱️  Timeout configurado: ${this.timeoutSeconds}s`);

      const now = new Date();
      this.logger.log(`🕐 Hora atual: ${now.toISOString()} (timestamp: ${now.getTime()})`);

      const expiresAt = DateUtil.addSeconds(now, this.timeoutSeconds);
      this.logger.log(`⏰ ExpiresAt calculado: ${expiresAt.toISOString()}`);
      this.logger.log(`🔢 ExpiresAt timestamp: ${expiresAt.getTime()}`);

      // Validar se a data de expiração é válida
      if (isNaN(expiresAt.getTime())) {
        this.logger.error(`❌ Data de expiração inválida!`);
        this.logger.error(
          `   timeoutSeconds: ${this.timeoutSeconds} (type: ${typeof this.timeoutSeconds})`,
        );
        this.logger.error(`   Date.now(): ${Date.now()}`);
        this.logger.error(`   Date.now() + timeoutSeconds: ${Date.now() + this.timeoutSeconds}`);
        throw new Error('Timeout configuration is invalid');
      }

      this.logger.log(`✅ Validação OK - Criando no banco...`);

      const dataToSave = {
        phoneNumber: dto.phoneNumber,
        platform: dto.platform || 'whatsapp', // Plataforma de origem
        userId: dto.userId || undefined, // Adicionar userId se fornecido
        accountId: dto.accountId || undefined, // Adicionar accountId para multi-contas
        messageId: dto.messageId,
        type: dto.type,
        amount: dto.amount,
        category: dto.category,
        categoryId: dto.categoryId || undefined, // ID da categoria resolvida
        subCategoryId: dto.subCategoryId || undefined, // ID da subcategoria resolvida
        subCategoryName: dto.subCategoryName || undefined, // Nome da subcategoria
        description: dto.description || undefined, // Apenas se IA extraiu, não a mensagem original
        date: transactionDate,
        extractedData: dto.extractedData || {},
        status: ConfirmationStatus.PENDING,
        expiresAt,
      };

      this.logger.log(`📦 Dados que serão salvos no banco:`);
      this.logger.log(
        JSON.stringify(
          {
            ...dataToSave,
            date: transactionDate.toISOString(),
            dateType: typeof transactionDate,
            dateValid: !isNaN(transactionDate.getTime()),
            expiresAt: expiresAt.toISOString(),
          },
          null,
          2,
        ),
      );

      const confirmation = await this.prisma.transactionConfirmation.create({
        data: dataToSave,
      });

      this.logger.log(
        `✅ Confirmação criada: ${confirmation.id} - ${dto.type} R$ ${dto.amount / 100}`,
      );
      this.logger.log(`============================================\n`);

      return confirmation;
    } catch (error) {
      this.logger.error('Erro ao criar confirmação:', error);
      this.logger.error('📋 DTO recebido:');
      this.logger.error(
        JSON.stringify(
          {
            ...dto,
            date: dto.date
              ? {
                  value: dto.date,
                  type: typeof dto.date,
                  toString: dto.date?.toString?.(),
                  isValid: dto.date instanceof Date ? !isNaN(dto.date.getTime()) : 'not a date',
                }
              : null,
          },
          null,
          2,
        ),
      );
      throw error;
    }
  }

  /**
   * Busca confirmação pendente do usuário
   * @param accountId - Quando fornecido, filtra apenas confirmações desta conta (n:m)
   */
  async getPendingConfirmation(phoneNumber: string, accountId?: string | null): Promise<TransactionConfirmation | null> {
    return this.prisma.transactionConfirmation.findFirst({
      where: {
        phoneNumber,
        status: ConfirmationStatus.PENDING,
        deletedAt: null,
        ...(accountId ? { accountId } : {}),
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Busca TODAS as confirmações pendentes do usuário
   * @param accountId - Quando fornecido, filtra apenas confirmações desta conta (n:m)
   */
  async getAllPendingConfirmations(phoneNumber: string, accountId?: string | null): Promise<TransactionConfirmation[]> {
    return this.prisma.transactionConfirmation.findMany({
      where: {
        phoneNumber,
        status: ConfirmationStatus.PENDING,
        deletedAt: null,
        expiresAt: {
          gt: new Date(), // Apenas não expiradas
        },
        ...(accountId ? { accountId } : {}),
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  /**
   * Conta confirmações pendentes do usuário
   * @param accountId - Quando fornecido, filtra apenas confirmações desta conta (n:m)
   */
  async countPendingConfirmations(phoneNumber: string, accountId?: string | null): Promise<number> {
    return this.prisma.transactionConfirmation.count({
      where: {
        phoneNumber,
        status: ConfirmationStatus.PENDING,
        deletedAt: null,
        expiresAt: {
          gt: new Date(),
        },
        ...(accountId ? { accountId } : {}),
      },
    });
  }

  /**
   * Processa resposta de confirmação (sim/não)
   */
  async processResponse(
    phoneNumber: string,
    response: string,
  ): Promise<{
    confirmation: TransactionConfirmation | null;
    action: 'confirmed' | 'rejected' | 'invalid' | 'list_shown' | 'change_category';
  }> {
    const sanitizedResponse = response.trim().toLowerCase();

    // Verificar se usuário pediu lista de confirmações
    if (
      sanitizedResponse === 'lista' ||
      sanitizedResponse === 'listar' ||
      sanitizedResponse === 'pendentes'
    ) {
      await this.showPendingList(phoneNumber);
      return { confirmation: null, action: 'list_shown' };
    }

    const confirmation = await this.getPendingConfirmation(phoneNumber);

    if (!confirmation) {
      return { confirmation: null, action: 'invalid' };
    }

    // Verificar se expirou
    if (new Date() > confirmation.expiresAt) {
      await this.expire(confirmation.id);
      return { confirmation: null, action: 'invalid' };
    }

    // Verificar se é pedido de troca de categoria
    const sanitizedForCheck = MessageSanitizerUtil.normalize(response);
    const isChangeRequest = [
      'trocar',
      'mudar',
      'outra categoria',
      'categoria errada',
      'errou',
      'categoria errado',
      'errou categoria',
      'mudar categoria',
      'trocar categoria',
      'categoria incorreta',
    ].some((k) => sanitizedForCheck.includes(k));
    if (isChangeRequest) {
      this.logger.log(`🔄 Usuário pediu mudança de categoria para a confirmação: ${confirmation.id}`);
      return { confirmation, action: 'change_category' };
    }

    // Verificar resposta
    const isAffirmative = MessageSanitizerUtil.isAffirmative(response);
    const isNegative = MessageSanitizerUtil.isNegative(response);

    if (isAffirmative) {
      const updated = await this.confirm(confirmation.id);
      this.logger.log(`✅ Transação confirmada: ${confirmation.id}`);

      // Emitir evento para enviar mensagem de sucesso
      await this.emitReply(
        phoneNumber,
        '✅ Transação confirmada! Estamos registrando...',
        'TRANSACTION_RESULT',
        { confirmationId: confirmation.id },
      );

      return { confirmation: updated, action: 'confirmed' };
    }

    if (isNegative) {
      const updated = await this.reject(confirmation.id);
      this.logger.log(`❌ Transação rejeitada: ${confirmation.id}`);

      // Emitir evento para enviar mensagem de cancelamento
      await this.emitReply(phoneNumber, '❌ Transação cancelada.', 'TRANSACTION_RESULT', {
        confirmationId: confirmation.id,
      });

      return { confirmation: updated, action: 'rejected' };
    }

    // ✅ NOVO: Resposta inválida - orientar usuário
    this.logger.log(`⚠️ Resposta inválida recebida: "${response}"`);

    const typeEmoji = confirmation.type === 'EXPENSES' ? '💸' : '💰';
    const typeText = confirmation.type === 'EXPENSES' ? 'Gasto' : 'Receita';
    const amount = Number(confirmation.amount).toFixed(2);

    let message =
      `❓ *Não entendi sua resposta*\n\n` +
      `Você tem uma confirmação pendente:\n\n` +
      `${typeEmoji} *${typeText}:* R$ ${amount}\n` +
      `📂 *Categoria:* ${confirmation.category}\n`;

    if (confirmation.description) {
      message += `📝 *Descrição:* ${confirmation.description}\n`;
    }

    message +=
      `\n*Por favor, responda:*\n` +
      `✅ *"sim"* para confirmar\n` +
      `❌ *"não"* para cancelar\n` +
      `� *"trocar"* para mudar a categoria\n` +
      `�📋 *"lista"* para ver todas as pendentes`;

    // Verificar se há múltiplas confirmações
    const pendingCount = await this.countPendingConfirmations(phoneNumber);
    if (pendingCount > 1) {
      message += `\n\n⚠️ Você tem *${pendingCount} confirmações* pendentes. Digite *"lista"* para ver todas.`;
    }

    await this.emitReply(phoneNumber, message, 'CONFIRMATION_REQUEST', {
      confirmationId: confirmation.id,
      action: 'invalid_response_guidance',
      originalResponse: response,
    });

    return { confirmation, action: 'invalid' };
  }

  /**
   * Mostra lista de confirmações pendentes
   */
  private async showPendingList(phoneNumber: string): Promise<void> {
    const confirmations = await this.getAllPendingConfirmations(phoneNumber);

    if (confirmations.length === 0) {
      await this.emitReply(phoneNumber, '✅ Você não tem confirmações pendentes.', 'INTENT_RESPONSE', {
        action: 'list_empty',
      });
      return;
    }

    let message = `📋 *Confirmações Pendentes* (${confirmations.length})\n\n`;

    confirmations.forEach((conf, index) => {
      const typeEmoji = conf.type === 'EXPENSES' ? '💸' : '💰';
      const typeText = conf.type === 'EXPENSES' ? 'Gasto' : 'Receita';
      const amount = Number(conf.amount).toFixed(2);
      const expiresIn = Math.floor((conf.expiresAt.getTime() - Date.now()) / 1000);
      const minutes = Math.floor(expiresIn / 60);
      const seconds = expiresIn % 60;

      message += `*${index + 1}.* ${typeEmoji} ${typeText}: R$ ${amount}\n`;
      message += `   📂 ${conf.category}\n`;
      if (conf.description) {
        message += `   📝 ${conf.description}\n`;
      }
      message += `   ⏰ Expira em: ${minutes}m ${seconds}s\n\n`;
    });

    message +=
      `*Para responder:*\n` +
      `✅ Digite *"sim"* para confirmar a mais recente\n` +
      `❌ Digite *"não"* para cancelar a mais recente`;

    await this.emitReply(phoneNumber, message, 'CONFIRMATION_REQUEST', {
      action: 'list_shown',
      count: confirmations.length,
    });
  }

  /**
   * Confirma transação
   */
  async confirm(confirmationId: string): Promise<TransactionConfirmation> {
    return this.prisma.transactionConfirmation.update({
      where: { id: confirmationId, deletedAt: null },
      data: {
        status: ConfirmationStatus.CONFIRMED,
        confirmedAt: new Date(),
      },
    });
  }

  /**
   * Rejeita transação
   */
  async reject(confirmationId: string): Promise<TransactionConfirmation> {
    return this.prisma.transactionConfirmation.update({
      where: { id: confirmationId, deletedAt: null },
      data: {
        status: ConfirmationStatus.REJECTED,
      },
    });
  }

  /**
   * Expira transação
   */
  async expire(confirmationId: string): Promise<TransactionConfirmation> {
    return this.prisma.transactionConfirmation.update({
      where: { id: confirmationId, deletedAt: null },
      data: {
        status: ConfirmationStatus.EXPIRED,
      },
    });
  }

  /**
   * Expira todas as confirmações antigas (cron job)
   */
  async expireOldConfirmations(): Promise<number> {
    const result = await this.prisma.transactionConfirmation.updateMany({
      where: {
        status: ConfirmationStatus.PENDING,
        deletedAt: null,
        expiresAt: {
          lt: new Date(),
        },
      },
      data: {
        status: ConfirmationStatus.EXPIRED,
      },
    });

    if (result.count > 0) {
      this.logger.log(`⏰ ${result.count} confirmações expiradas`);
    }

    return result.count;
  }

  /**
   * Formata mensagem de confirmação para enviar ao usuário
   */
  formatConfirmationMessage(confirmation: TransactionConfirmation): string {
    const typeEmoji = confirmation.type === 'EXPENSES' ? '💸' : '💰';
    const typeText = confirmation.type === 'EXPENSES' ? 'gasto' : 'receita';

    const amountFormatted = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(Number(confirmation.amount));

    let message = `${typeEmoji} Detectei um *${typeText}* de *${amountFormatted}*\n\n`;

    message += `📂 *Categoria:* ${confirmation.category}\n`;

    if (confirmation.description) {
      message += `📝 *Descrição:* ${confirmation.description}\n`;
    }

    if (confirmation.date) {
      const dateFormatted = new Intl.DateTimeFormat('pt-BR').format(new Date(confirmation.date));
      message += `📅 *Data:* ${dateFormatted}\n`;
    }

    message += `\n*Confirmar?* (sim/não/trocar)`;

    return message;
  }

  /**
   * Conta confirmações pendentes
   */
  async countPending(): Promise<number> {
    return this.prisma.transactionConfirmation.count({
      where: {
        status: ConfirmationStatus.PENDING,
      },
    });
  }

  /**
   * Busca confirmação por ID
   */
  async getById(id: string): Promise<TransactionConfirmation | null> {
    return this.prisma.transactionConfirmation.findUnique({
      where: { id },
    });
  }

  /**
   * Atualiza a categoria de uma confirmação pendente
   */
  async updateCategory(
    confirmationId: string,
    category: string,
    categoryId: string | null,
    subCategoryId: string | null,
    subCategoryName: string | null,
  ): Promise<TransactionConfirmation> {
    this.logger.log(
      `🔄 Atualizando categoria da confirmação ${confirmationId}: ${category}`,
    );
    return this.prisma.transactionConfirmation.update({
      where: { id: confirmationId, deletedAt: null },
      data: {
        category,
        categoryId: categoryId ?? undefined,
        subCategoryId: subCategoryId ?? undefined,
        subCategoryName: subCategoryName ?? undefined,
      },
    });
  }
}

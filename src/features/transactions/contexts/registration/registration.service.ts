import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIProviderFactory } from '@infrastructure/ai/ai-provider.factory';
import { AIConfigService } from '@infrastructure/ai/ai-config.service';
import { RAGService } from '@infrastructure/ai/rag/rag.service';
import { TransactionValidatorService } from '../../transaction-validator.service';
import { TransactionConfirmationService } from '../../transaction-confirmation.service';
import { GastoCertoApiService } from '@shared/gasto-certo-api.service';
import { UserCacheService } from '../../../users/user-cache.service';
import { AccountManagementService } from '../../../accounts/account-management.service';
import { TransactionData, TransactionType } from '@infrastructure/ai/ai.interface';
import { UserCache } from '@prisma/client';
import {
  CreateTransactionConfirmationDto,
  CreateGastoCertoTransactionDto,
} from '../../dto/transaction.dto';
import { DateUtil } from '../../../../utils/date.util';

/**
 * TransactionRegistrationService
 *
 * Responsável pelo contexto de REGISTRO de transações:
 * - Validação de conta ativa
 * - Extração de dados via IA (texto, imagem, áudio)
 * - Validação de dados extraídos
 * - Criação de confirmações
 * - Registro automático (alta confiança)
 * - Comunicação com GastoCerto API
 */
@Injectable()
export class TransactionRegistrationService {
  private readonly logger = new Logger(TransactionRegistrationService.name);
  private readonly requireConfirmation: boolean;
  private readonly autoRegisterThreshold: number;
  private readonly minConfidenceThreshold: number;

  constructor(
    private readonly aiFactory: AIProviderFactory,
    private readonly aiConfigService: AIConfigService,
    private readonly validator: TransactionValidatorService,
    private readonly confirmationService: TransactionConfirmationService,
    private readonly gastoCertoApi: GastoCertoApiService,
    private readonly userCache: UserCacheService,
    private readonly accountManagement: AccountManagementService,
    private readonly configService: ConfigService,
    @Optional() private readonly ragService?: RAGService,
  ) {
    this.requireConfirmation = this.configService.get<boolean>('REQUIRE_CONFIRMATION', true);
    this.autoRegisterThreshold = this.configService.get<number>('AUTO_REGISTER_THRESHOLD', 0.8);
    this.minConfidenceThreshold = this.configService.get<number>('MIN_CONFIDENCE_THRESHOLD', 0.5);

    this.logger.log(
      `🎯 [Registration] Configuração: ` +
        `requireConfirmation=${this.requireConfirmation}, ` +
        `autoRegisterThreshold=${this.autoRegisterThreshold}, ` +
        `minConfidenceThreshold=${this.minConfidenceThreshold}, ` +
        `ragAvailable=${!!this.ragService}`,
    );
  }

  /**
   * Valida se usuário tem conta ativa antes de registrar transação
   */
  private async validateAccountBeforeTransaction(phoneNumber: string): Promise<{
    valid: boolean;
    message?: string;
    accountId?: string;
  }> {
    const validation = await this.accountManagement.validateActiveAccount(phoneNumber);

    if (!validation.valid) {
      return {
        valid: false,
        message: validation.message,
      };
    }

    return {
      valid: true,
      accountId: validation.account.id,
    };
  }

  /**
   * Processa mensagem de texto e extrai transação
   */
  async processTextTransaction(
    phoneNumber: string,
    text: string,
    messageId: string,
    user: UserCache,
  ): Promise<{
    success: boolean;
    message: string;
    requiresConfirmation: boolean;
    confirmationId?: string;
    autoRegistered?: boolean;
  }> {
    try {
      this.logger.log(`📝 [Registration] Processando texto de ${phoneNumber}: "${text}"`);

      // 0. Validar conta ativa
      const accountValidation = await this.validateAccountBeforeTransaction(phoneNumber);
      if (!accountValidation.valid) {
        return {
          success: false,
          message: accountValidation.message || '❌ Conta ativa não encontrada.',
          requiresConfirmation: false,
        };
      }

      // 1. Buscar categorias do usuário
      const categoriesData = await this.userCache.getUserCategories(phoneNumber);
      const userContext = {
        name: user.name,
        email: user.email,
        categories: categoriesData.categories,
      };

      // 1.5. Indexar categorias no RAG (se disponível E habilitado)
      const aiSettings = await this.aiConfigService.getSettings();
      const ragEnabled = aiSettings.ragEnabled && this.ragService;

      if (ragEnabled && categoriesData.categories.length > 0) {
        try {
          const userCategories = categoriesData.categories.map((cat) => ({
            id: cat.id || cat.categoryId,
            name: cat.name || cat.categoryName,
            accountId: cat.accountId, // accountId vem da categoria, não do user
            subCategory: cat.subCategory
              ? {
                  id: cat.subCategory.id || cat.subCategory.subCategoryId,
                  name: cat.subCategory.name || cat.subCategory.subCategoryName,
                }
              : undefined,
          }));

          await this.ragService.indexUserCategories(user.gastoCertoId, userCategories);
          this.logger.log(
            `🧠 RAG indexado: ${userCategories.length} categorias | ` +
              `UserId: ${user.gastoCertoId} | Modo: ${aiSettings.ragAiEnabled ? 'AI' : 'BM25'}`,
          );
        } catch (ragError) {
          this.logger.warn(`⚠️ Erro ao indexar RAG (não bloqueante):`, ragError);
        }
      }

      // 2. Extrair dados da transação via IA
      this.logger.log(`🤖 Chamando IA para extrair transação...`);
      const startTime = Date.now();
      const extractedData = await this.aiFactory.extractTransaction(text, userContext);
      const responseTime = Date.now() - startTime;

      // 2.5. Melhorar categoria usando RAG (se habilitado e categoria extraída)
      if (ragEnabled && extractedData.category) {
        try {
          const ragThreshold = aiSettings.ragThreshold || 0.75;
          const ragMatches = await this.ragService.findSimilarCategories(
            extractedData.category,
            user.gastoCertoId,
            { minScore: 0.6, maxResults: 1 },
          );

          if (ragMatches.length > 0 && ragMatches[0].score >= ragThreshold) {
            const bestMatch = ragMatches[0];
            this.logger.log(
              `🧠 RAG melhorou categoria: ` +
                `"${extractedData.category}" → "${bestMatch.categoryName}" ` +
                `(score: ${(bestMatch.score * 100).toFixed(1)}%)`,
            );

            // Atualizar categoria com o match do RAG
            extractedData.category = bestMatch.categoryName;
            if (bestMatch.subCategoryName) {
              extractedData.subCategory = bestMatch.subCategoryName;
            }

            // Aumentar confiança se RAG deu bom match
            extractedData.confidence = Math.min(
              extractedData.confidence + bestMatch.score * 0.1,
              1.0,
            );
          }
        } catch (ragError) {
          this.logger.warn(`⚠️ Erro no RAG (não bloqueante):`, ragError);
        }
      }

      this.logger.log(
        `✅ Transação extraída | ` +
          `Tipo: ${extractedData.type} | ` +
          `Valor: R$ ${extractedData.amount} | ` +
          `Categoria: ${extractedData.category} | ` +
          `Confiança: ${(extractedData.confidence * 100).toFixed(1)}%`,
      );

      // Registrar uso de IA
      try {
        await this.aiFactory.logAIUsage({
          phoneNumber,
          userCacheId: user.id,
          operation: 'TRANSACTION_EXTRACTION',
          inputType: 'TEXT',
          inputText: text,
          inputTokens: Math.ceil(text.length / 4),
          outputTokens: Math.ceil(JSON.stringify(extractedData).length / 4),
          metadata: {
            confidence: extractedData.confidence,
            category: extractedData.category,
            amount: extractedData.amount,
            type: extractedData.type,
            responseTimeMs: responseTime,
          },
        });
      } catch (logError) {
        this.logger.error(`⚠️ Erro ao registrar AI usage:`, logError);
      }

      // 3. Validar dados extraídos
      const validation = this.validator.validate(extractedData);
      if (!validation.isValid) {
        this.logger.warn(`❌ Validação falhou: ${validation.errors.join(', ')}`);
        return {
          success: false,
          message: this.formatValidationError(validation.errors),
          requiresConfirmation: false,
        };
      }

      // 4. Verificar confiança mínima
      if (extractedData.confidence < this.minConfidenceThreshold) {
        this.logger.warn(
          `⚠️ Confiança muito baixa: ${(extractedData.confidence * 100).toFixed(1)}%`,
        );
        return {
          success: false,
          message:
            '❓ *Não entendi bem sua mensagem*\n\n' +
            'Por favor, tente ser mais específico. Exemplo:\n' +
            '_"Gastei R$ 50,00 em alimentação no mercado"_',
          requiresConfirmation: false,
        };
      }

      // 5. Decidir entre registro automático ou confirmação
      const shouldAutoRegister =
        !this.requireConfirmation && extractedData.confidence >= this.autoRegisterThreshold;

      if (shouldAutoRegister) {
        return await this.autoRegisterTransaction(phoneNumber, extractedData, messageId, user);
      } else {
        return await this.createConfirmation(phoneNumber, extractedData, messageId, user);
      }
    } catch (error) {
      this.logger.error(`❌ Erro ao processar texto:`, error);
      throw error;
    }
  }

  /**
   * Processa imagem e extrai transação (nota fiscal, cupom, etc)
   */
  async processImageTransaction(
    phoneNumber: string,
    imageBuffer: Buffer,
    mimeType: string,
    messageId: string,
    user: UserCache,
  ): Promise<{
    success: boolean;
    message: string;
    requiresConfirmation: boolean;
    confirmationId?: string;
  }> {
    try {
      this.logger.log(`🖼️ [Registration] Processando imagem de ${phoneNumber}`);

      // 0. Validar conta ativa
      const accountValidation = await this.validateAccountBeforeTransaction(phoneNumber);
      if (!accountValidation.valid) {
        return {
          success: false,
          message: accountValidation.message || '❌ Conta ativa não encontrada.',
          requiresConfirmation: false,
        };
      }

      // 1. Buscar categorias do usuário
      const categoriesData = await this.userCache.getUserCategories(phoneNumber);
      const userContext = {
        name: user.name,
        email: user.email,
        categories: categoriesData.categories,
      };

      // 2. Extrair dados da imagem via IA
      this.logger.log(`🤖 Analisando imagem com IA...`);
      const startTime = Date.now();
      const extractedData = await this.aiFactory.analyzeImage(imageBuffer, mimeType);
      const responseTime = Date.now() - startTime;

      this.logger.log(
        `✅ Transação extraída da imagem | ` +
          `Tipo: ${extractedData.type} | ` +
          `Valor: R$ ${extractedData.amount} | ` +
          `Categoria: ${extractedData.category} | ` +
          `Confiança: ${(extractedData.confidence * 100).toFixed(1)}%`,
      );

      // Registrar uso de IA
      try {
        await this.aiFactory.logAIUsage({
          phoneNumber,
          userCacheId: user.id,
          operation: 'IMAGE_ANALYSIS',
          inputType: 'IMAGE',
          inputText: `Image: ${mimeType}`,
          inputTokens: Math.ceil(imageBuffer.length / 1000), // Aproximação para imagem
          outputTokens: Math.ceil(JSON.stringify(extractedData).length / 4),
          metadata: {
            confidence: extractedData.confidence,
            category: extractedData.category,
            amount: extractedData.amount,
            type: extractedData.type,
            responseTimeMs: responseTime,
            imageSize: imageBuffer.length,
            mimeType,
          },
        });
      } catch (logError) {
        this.logger.error(`⚠️ Erro ao registrar AI usage:`, logError);
      }

      // 3. Validar dados
      const validation = this.validator.validate(extractedData);
      if (!validation.isValid) {
        return {
          success: false,
          message: this.formatValidationError(validation.errors),
          requiresConfirmation: false,
        };
      }

      // 4. Sempre pedir confirmação para imagens (mesmo com alta confiança)
      return await this.createConfirmation(phoneNumber, extractedData, messageId, user);
    } catch (error) {
      this.logger.error(`❌ Erro ao processar imagem:`, error);
      throw error;
    }
  }

  /**
   * Processa áudio e extrai transação
   */
  async processAudioTransaction(
    phoneNumber: string,
    audioBuffer: Buffer,
    mimeType: string,
    messageId: string,
    user: UserCache,
  ): Promise<{
    success: boolean;
    message: string;
    requiresConfirmation: boolean;
    confirmationId?: string;
  }> {
    try {
      this.logger.log(`🎤 [Registration] Processando áudio de ${phoneNumber}`);

      // 1. Transcrever áudio
      this.logger.log(`🤖 Transcrevendo áudio...`);
      const transcription = await this.aiFactory.transcribeAudio(audioBuffer, mimeType);

      this.logger.log(`📝 Transcrição: "${transcription}"`);

      // 2. Processar como texto
      return await this.processTextTransaction(phoneNumber, transcription, messageId, user);
    } catch (error) {
      this.logger.error(`❌ Erro ao processar áudio:`, error);
      throw error;
    }
  }

  /**
   * Registra transação automaticamente (alta confiança)
   */
  private async autoRegisterTransaction(
    phoneNumber: string,
    data: TransactionData,
    messageId: string,
    user: UserCache,
  ): Promise<{
    success: boolean;
    message: string;
    requiresConfirmation: boolean;
    autoRegistered: boolean;
  }> {
    try {
      this.logger.log(`⚡ Registro automático (confiança: ${(data.confidence * 100).toFixed(1)}%)`);

      // Preparar objeto de confirmação temporário para usar método genérico
      const tempConfirmation = {
        phoneNumber,
        type: data.type,
        amount: Math.round(data.amount * 100), // Converter para centavos
        category: data.category,
        description: data.description,
        date: data.date ? DateUtil.normalizeDate(data.date) : DateUtil.today(),
        extractedData: {
          merchant: data.merchant,
          confidence: data.confidence,
          subcategory: data.subCategory,
        },
      };

      // Usar método genérico para enviar
      const result = await this.sendTransactionToApi(tempConfirmation, data);

      if (result.success && result.transactionId) {
        const typeEmoji = data.type === 'EXPENSES' ? '💸' : '💰';
        const typeText = data.type === 'EXPENSES' ? 'Gasto' : 'Receita';
        const subcategoryText = data.subCategory ? ` → ${data.subCategory}` : '';

        return {
          success: true,
          message:
            `✅ *${typeText} registrado automaticamente!*\n\n` +
            `${typeEmoji} *Valor:* R$ ${data.amount.toFixed(2)}\n` +
            `📂 *Categoria:* ${data.category}${subcategoryText}\n` +
            `${data.description ? `📝 *Descrição:* ${data.description}\n` : ''}` +
            `${data.date ? `📅 *Data:* ${DateUtil.formatBR(DateUtil.normalizeDate(data.date))}\n` : ''}\n` +
            `🎯 *Confiança:* ${(data.confidence * 100).toFixed(0)}%\n` +
            `✅ _ID: ${result.transactionId}_`,
          requiresConfirmation: false,
          autoRegistered: true,
        };
      } else {
        const errorMsg = result.error || 'Erro ao registrar na API';
        throw new Error(errorMsg);
      }
    } catch (error) {
      this.logger.error(`❌ Erro no registro automático:`, error);
      // Fallback: criar confirmação se auto-registro falhar
      const confirmation = await this.createConfirmation(phoneNumber, data, messageId, user);
      return {
        ...confirmation,
        autoRegistered: false,
      };
    }
  }

  /**
   * Cria confirmação pendente para o usuário
   */
  private async createConfirmation(
    phoneNumber: string,
    data: TransactionData,
    messageId: string,
    user?: UserCache, // User opcional para incluir userId
  ): Promise<{
    success: boolean;
    message: string;
    requiresConfirmation: boolean;
    confirmationId: string;
  }> {
    try {
      // Usar DateUtil para normalizar a data (fallback para hoje se inválida)
      let validDate: Date;
      try {
        validDate = data.date ? DateUtil.normalizeDate(data.date) : DateUtil.today();
      } catch {
        // Se a data fornecida for inválida, usa data atual
        validDate = DateUtil.today();
      }

      // Converter amount de reais para centavos (IA retorna em reais)
      const amountInCents = Math.round(data.amount * 100);

      const dto: CreateTransactionConfirmationDto = {
        phoneNumber,
        userId: user?.id, // Incluir userId se user disponível
        messageId,
        type: data.type as any,
        amount: amountInCents,
        category: data.category,
        description: data.description,
        date: validDate,
        extractedData: {
          merchant: data.merchant,
          confidence: data.confidence,
          subcategory: data.subCategory,
        },
      };

      const confirmation = await this.confirmationService.create(dto);

      const typeEmoji = data.type === 'EXPENSES' ? '💸' : '💰';
      const typeText = data.type === 'EXPENSES' ? 'Gasto' : 'Receita';

      return {
        success: true,
        message:
          `${typeEmoji} *Confirmar ${typeText}?*\n\n` +
          `💵 *Valor:* R$ ${data.amount.toFixed(2)}\n` +
          `📂 *Categoria:* ${data.category}${data.subCategory ? ` > ${data.subCategory}` : ''}\n` +
          `${data.description ? `📝 *Descrição:* ${data.description}\n` : ''}` +
          `${data.date ? `📅 *Data:* ${DateUtil.formatBR(validDate)}\n` : ''}` +
          `${data.merchant ? `🏪 *Local:* ${data.merchant}\n` : ''}\n` +
          `✅ Digite *"sim"* para confirmar\n` +
          `❌ Digite *"não"* para cancelar`,
        requiresConfirmation: true,
        confirmationId: confirmation.id,
      };
    } catch (error) {
      this.logger.error(`❌ Erro ao criar confirmação:`, error);
      throw error;
    }
  }

  /**
   * Formata erros de validação de forma amigável
   */
  private formatValidationError(errors: string[]): string {
    return (
      '❌ *Dados inválidos*\n\n' +
      errors.map((err) => `• ${err}`).join('\n') +
      '\n\n_Por favor, corrija e tente novamente._'
    );
  }

  /**
   * Registra transação confirmada pelo usuário na API GastoCerto
   */
  async registerConfirmedTransaction(
    confirmation: any,
  ): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.log(`💾 [Registration] Registrando transação confirmada ID: ${confirmation.id}`);

      // Enviar para API usando método genérico
      const result = await this.sendTransactionToApi(confirmation);

      if (result.success && result.transactionId) {
        const typeEmoji = confirmation.type === 'EXPENSES' ? '💸' : '💰';
        const subCategoryText = confirmation.extractedData?.subcategory
          ? ` > ${confirmation.extractedData.subcategory}`
          : '';

        const successMessage =
          `${typeEmoji} *Transação registrada com sucesso!*\n\n` +
          `💵 *Valor:* R$ ${(Number(confirmation.amount) / 100).toFixed(2)}\n` +
          `📂 *Categoria:* ${confirmation.category}${subCategoryText}\n` +
          `${confirmation.description ? `📝 ${confirmation.description}\n` : ''}` +
          `✅ _ID: ${result.transactionId}_`;

        return {
          success: true,
          message: successMessage,
        };
      } else {
        this.logger.error(`❌ Erro na API GastoCerto:`, result.error);
        return {
          success: false,
          message:
            '❌ *Erro ao registrar transação*\n\n' +
            (result.error || 'Erro desconhecido') +
            '\n\n_Por favor, tente novamente mais tarde._',
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
   * Método específico para retry job - retorna transactionId
   * Usado pelo ApiRetryJob para reenviar transações falhadas
   */
  async sendConfirmedTransactionToApi(confirmation: any): Promise<{
    success: boolean;
    error?: string;
    transactionId?: string;
  }> {
    // Usar método genérico
    return await this.sendTransactionToApi(confirmation);
  }

  /**
   * Método genérico para enviar transação para API GastoCerto
   * Consolida a lógica de envio usada em todos os fluxos
   */
  private async sendTransactionToApi(
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
        return {
          success: false,
          error: 'Usuário não encontrado',
        };
      }

      // 2. Buscar conta ativa do usuário (do cache local)
      const activeAccount = await this.userCache.getActiveAccount(confirmation.phoneNumber);
      if (!activeAccount) {
        this.logger.warn(`⚠️ Conta ativa não encontrada para usuário ${user.gastoCertoId}`);
        return {
          success: false,
          error: 'Conta ativa não encontrada. Use "minhas contas" para configurar.',
        };
      }

      const accountId = activeAccount.id;
      this.logger.log(`✅ Usando conta ativa: ${activeAccount.name} (${accountId})`);

      // 3. Buscar categorias da conta e resolver IDs
      const { categoryId, subCategoryId } = await this.resolveCategoryAndSubcategory(
        user.gastoCertoId,
        accountId,
        confirmation.category,
        confirmation.extractedData?.subcategory || data?.subCategory,
      );

      if (!categoryId) {
        return {
          success: false,
          error: 'Categoria não encontrada',
        };
      }

      // 4. Preparar DTO para API
      const dto: CreateGastoCertoTransactionDto = {
        userId: user.gastoCertoId,
        accountId, // Adicionar conta default
        type: confirmation.type as TransactionType, // Manter maiúsculo (EXPENSES | INCOME)
        amount: Number(confirmation.amount),
        categoryId,
        subCategoryId,
        description:
          confirmation.description ||
          data?.description ||
          confirmation.extractedData?.description ||
          'Sem descrição',
        date: confirmation.date
          ? DateUtil.formatToISO(DateUtil.normalizeDate(confirmation.date))
          : DateUtil.formatToISO(DateUtil.today()),
        merchant: confirmation.extractedData?.merchant || data?.merchant,
        source: 'whatsapp',
      };

      this.logger.log(`📤 Enviando para GastoCerto API:`, JSON.stringify(dto, null, 2));

      // 5. Registrar na API
      const response = await this.gastoCertoApi.createTransaction(dto);

      if (response.success && response.transaction) {
        return {
          success: true,
          transactionId: response.transaction.id,
        };
      } else {
        const errorMsg =
          typeof response.error === 'string'
            ? response.error
            : response.error?.message || 'Erro desconhecido na API';

        return {
          success: false,
          error: errorMsg,
        };
      }
    } catch (error: any) {
      this.logger.error(`❌ Erro ao enviar transação:`, error);
      return {
        success: false,
        error: error.message || 'Erro ao enviar transação',
      };
    }
  }

  /**
   * Busca o ID da conta default do usuário
   */
  /**
   * Helper para resolver categoria e subcategoria da conta
   * Busca primeiro no cache local, depois na API se necessário
   * Retorna IDs a partir de nomes ou IDs
   */
  private async resolveCategoryAndSubcategory(
    userId: string,
    accountId: string,
    categoryNameOrId: string,
    subcategoryNameOrId?: string,
  ): Promise<{ categoryId: string | null; subCategoryId: string | null }> {
    try {
      // Buscar usuário no cache local
      const user = await this.userCache.findByPlatformId(userId, 'whatsapp');

      let categoriesData: any[] = [];

      // 1. Tentar buscar categorias do cache local (user_cache.categories)
      if (user && user.categories && Array.isArray(user.categories)) {
        const cachedCategories = user.categories as any[];

        // Filtrar categorias da conta específica
        categoriesData = cachedCategories.filter((cat: any) => cat.accountId === accountId);

        if (categoriesData.length > 0) {
          this.logger.log(`📦 Usando ${categoriesData.length} categoria(s) do cache local`);
        }
      }

      // 2. Se não houver categorias no cache, buscar na API
      if (categoriesData.length === 0) {
        this.logger.log(`🔍 Buscando categorias na API (cache vazio)`);
        categoriesData = await this.gastoCertoApi.getAccountCategories(userId, accountId);

        if (!categoriesData || categoriesData.length === 0) {
          this.logger.warn(`⚠️ Conta ${accountId} não possui categorias`);
          return { categoryId: null, subCategoryId: null };
        }
      }

      // 3. Procurar categoria (case-insensitive)
      const matchingCategory = categoriesData.find(
        (cat: any) =>
          cat.name.toLowerCase() === categoryNameOrId.toLowerCase() || cat.id === categoryNameOrId,
      );

      if (!matchingCategory) {
        this.logger.warn(`⚠️ Categoria não encontrada: ${categoryNameOrId}`);
        return { categoryId: null, subCategoryId: null };
      }

      const categoryId = matchingCategory.id;
      this.logger.log(`📂 Categoria resolvida: ${categoryNameOrId} → ${categoryId}`);

      // 4. Se não há subcategoria informada, retornar apenas categoria
      if (!subcategoryNameOrId) {
        return { categoryId, subCategoryId: null };
      }

      // 5. Procurar subcategoria dentro da categoria
      let subCategoryId: string | null = null;

      if (matchingCategory.subCategories && Array.isArray(matchingCategory.subCategories)) {
        const matchingSubCategory = matchingCategory.subCategories.find(
          (subCat: any) =>
            subCat.name.toLowerCase() === subcategoryNameOrId.toLowerCase() ||
            subCat.id === subcategoryNameOrId,
        );

        if (matchingSubCategory) {
          subCategoryId = matchingSubCategory.id;
          this.logger.log(`📂 Subcategoria resolvida: ${subcategoryNameOrId} → ${subCategoryId}`);
        } else {
          this.logger.warn(
            `⚠️ Subcategoria "${subcategoryNameOrId}" não encontrada na categoria "${matchingCategory.name}"`,
          );
        }
      }

      return { categoryId, subCategoryId };
    } catch (error: any) {
      this.logger.error(`❌ Erro ao resolver categoria/subcategoria:`, error);
      return { categoryId: null, subCategoryId: null };
    }
  }
}

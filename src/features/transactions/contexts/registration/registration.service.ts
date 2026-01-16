import { Injectable, Logger, Optional, forwardRef, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@core/database/prisma.service';
import { AIProviderFactory } from '@infrastructure/ai/ai-provider.factory';
import { AIConfigService } from '@infrastructure/ai/ai-config.service';
import { RAGService } from '@infrastructure/rag/services/rag.service';
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
import { TemporalParserService } from '@features/transactions/services/parsers/temporal-parser.service';
import { MessageLearningService } from '../../message-learning.service';
import {
  TRANSACTION_VERBS,
  TEMPORAL_WORDS,
  PREPOSITIONS,
  ARTICLES,
  COMMON_ADJECTIVES,
  COMMON_ESTABLISHMENTS,
  EXPENSE_KEYWORDS,
  INCOME_KEYWORDS,
} from '@common/constants/nlp-keywords.constants';
import { InstallmentParserService } from '@features/transactions/services/parsers/installment-parser.service';
import { FixedTransactionParserService } from '@features/transactions/services/parsers/fixed-transaction-parser.service';
import { CreditCardParserService } from '@features/transactions/services/parsers/credit-card-parser.service';
import { CreditCardInvoiceCalculatorService } from '@features/transactions/services/parsers/credit-card-invoice-calculator.service';
import { PaymentStatusResolverService } from '../../services/payment-status-resolver.service';
import { CreditCardService } from '@features/credit-cards/credit-card.service';

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
  private autoRegisterThreshold: number; // Removido readonly para permitir atualização do banco
  private minConfidenceThreshold: number; // Removido readonly para permitir atualização do banco

  constructor(
    private readonly aiFactory: AIProviderFactory,
    private readonly aiConfigService: AIConfigService,
    private readonly validator: TransactionValidatorService,
    private readonly confirmationService: TransactionConfirmationService,
    private readonly gastoCertoApi: GastoCertoApiService,
    private readonly userCache: UserCacheService,
    private readonly accountManagement: AccountManagementService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly temporalParser: TemporalParserService,
    private readonly installmentParser: InstallmentParserService,
    private readonly fixedParser: FixedTransactionParserService,
    private readonly creditCardParser: CreditCardParserService,
    private readonly invoiceCalculator: CreditCardInvoiceCalculatorService,
    private readonly paymentStatusResolver: PaymentStatusResolverService,
    private readonly creditCardService: CreditCardService,
    @Optional()
    @Inject(forwardRef(() => MessageLearningService))
    private readonly messageLearningService?: MessageLearningService,
    @Optional() private readonly ragService?: RAGService,
  ) {
    // Valores temporários até carregar do banco
    this.autoRegisterThreshold = 0.9;
    this.minConfidenceThreshold = 0.5;

    // ✅ LOG DE DEBUG DE INJEÇÃO
    this.logger.log(
      `🎓 [TransactionRegistrationService] Inicializado com: ` +
        `messageLearningService=${!!messageLearningService}, ` +
        `ragService=${!!ragService}`,
    );

    // Carregar configurações do banco
    this.loadSettings();
  }

  /**
   * Carrega configurações de threshold do banco (AISettings)
   */
  private async loadSettings(): Promise<void> {
    try {
      const settings = await this.prisma.aISettings.findFirst();

      if (settings) {
        this.autoRegisterThreshold = settings.autoRegisterThreshold;
        this.minConfidenceThreshold = settings.minConfidenceThreshold;

        this.logger.log(
          `🎯 [Registration] Configuração via BANCO: ` +
            `autoRegisterThreshold=${this.autoRegisterThreshold}, ` +
            `minConfidenceThreshold=${this.minConfidenceThreshold}, ` +
            `ragAvailable=${!!this.ragService}`,
        );
      } else {
        this.logger.warn(
          `⚠️  AISettings não encontrado - usando padrão: ` +
            `autoRegisterThreshold=${this.autoRegisterThreshold}, ` +
            `minConfidenceThreshold=${this.minConfidenceThreshold}`,
        );
      }
    } catch (error) {
      this.logger.error('Erro ao carregar configurações de threshold:', error);
    }
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
    platform: string = 'whatsapp',
    accountId?: string, // accountId contextual passado pelo provider
    skipLearning: boolean = false, // Evita loop infinito após confirmação
  ): Promise<{
    success: boolean;
    message: string;
    requiresConfirmation: boolean;
    confirmationId?: string;
    autoRegistered?: boolean;
  }> {
    try {
      this.logger.log(`📝 [Registration] Processando texto de ${phoneNumber}: "${text}"`);

      // 0. Usar accountId passado (OBRIGATÓRIO - não busca do cache)
      if (!accountId) {
        this.logger.error(`❌ AccountId não fornecido para ${phoneNumber}`);
        return {
          success: false,
          message: '❌ Erro interno: conta não identificada.',
          requiresConfirmation: false,
        };
      }

      const activeAccountId = accountId;
      this.logger.debug(`🏦 Usando accountId: ${activeAccountId}`);

      // 1. Buscar categorias do usuário (APENAS da conta ativa)
      const categoriesData = await this.userCache.getUserCategories(phoneNumber, activeAccountId);

      // Montar estrutura de categorias com subcategorias para IA
      const categoriesWithSubs = categoriesData.categories.map((cat) => ({
        id: cat.id || cat.categoryId,
        name: cat.name || cat.categoryName,
        subCategories:
          cat.subCategories?.map((sub) => ({
            id: sub.id || sub.subCategoryId,
            name: sub.name || sub.subCategoryName,
          })) || [],
      }));

      // DEBUG: Verificar quantas categorias têm subcategorias
      const withSubcategories = categoriesWithSubs.filter((c) => c.subCategories.length > 0);
      this.logger.debug(
        `📊 Categorias estruturadas para IA: ${categoriesWithSubs.length} total | ` +
          `${withSubcategories.length} com subcategorias`,
      );

      if (withSubcategories.length === 0) {
        this.logger.warn(
          `⚠️ PROBLEMA: API não retornou subcategorias! Todas categorias têm subCategories vazio.`,
        );
      } else {
        const example = withSubcategories[0];
        this.logger.debug(
          `✅ Exemplo: "${example.name}" tem ${example.subCategories.length} subcategorias: ` +
            `${example.subCategories
              .map((s) => s.name)
              .slice(0, 3)
              .join(', ')}...`,
        );
      }

      const userContext = {
        name: user.name,
        email: user.email,
        categories: categoriesWithSubs, // Estrutura completa com subs
      };

      this.logger.log(
        `👤 [DEBUG] User info: name=${user.name}, gastoCertoId=${user.gastoCertoId}, phoneNumber=${user.phoneNumber}`,
      );

      // 1.5. Indexar categorias no RAG (se disponível E habilitado)
      const aiSettings = await this.aiConfigService.getSettings();
      const ragEnabled = aiSettings.ragEnabled && this.ragService;

      // 🐛 DEBUG: Mostrar status do RAG
      this.logger.debug(
        `🔍 [RAG DEBUG] ragEnabled=${ragEnabled} | ` +
          `aiSettings.ragEnabled=${aiSettings.ragEnabled} | ` +
          `this.ragService=${!!this.ragService}`,
      );

      // Indexar categorias no RAG
      if (ragEnabled && categoriesData.categories.length > 0) {
        try {
          // Expandir cada categoria com suas subcategorias (criar entrada para cada uma)
          const { expandCategoriesForRAG } = await import('../../../users/user-cache.service');
          const userCategories = expandCategoriesForRAG(categoriesData.categories);

          // DEBUG: Contar categorias com subcategorias
          const withSubs = userCategories.filter((c) => c.subCategory);
          const withoutSubs = userCategories.filter((c) => !c.subCategory);

          this.logger.debug(
            `📊 Categorias expandidas para RAG: ${userCategories.length} entradas | ` +
              `${withSubs.length} COM subcategorias | ` +
              `${withoutSubs.length} SEM subcategorias`,
          );

          // DEBUG: Log exemplos
          const incomeExample = userCategories.find((c) => c.type === 'INCOME' && c.subCategory);
          const expenseExample = userCategories.find((c) => c.type === 'EXPENSES' && c.subCategory);

          if (incomeExample) {
            this.logger.debug(
              `💰 Exemplo INCOME: "${incomeExample.name}" > "${incomeExample.subCategory.name}"`,
            );
          }
          if (expenseExample) {
            this.logger.debug(
              `💸 Exemplo EXPENSES: "${expenseExample.name}" > "${expenseExample.subCategory.name}"`,
            );
          }

          if (withSubs.length === 0) {
            this.logger.warn(
              `⚠️  NENHUMA categoria tem subcategoria! Todas as ${userCategories.length} categorias estão sem subcategorias.`,
            );
          }

          await this.ragService.indexUserCategories(user.gastoCertoId, userCategories);
          this.logger.log(
            `🧠 RAG indexado: ${userCategories.length} categorias | ` +
              `UserId: ${user.gastoCertoId}`,
          );
        } catch (ragError) {
          this.logger.warn(`⚠️ Erro ao indexar RAG (não bloqueante):`, ragError);
        }
      }

      // 2. FASE 1: Tentar RAG primeiro (rápido, sem custo)
      let extractedData: any = null;
      let responseTime = 0;
      const usedAI = false;

      this.logger.log(
        `🚀 INICIANDO PROCESSAMENTO | Platform: ${platform} | Phone: ${phoneNumber} | Message: "${text.substring(0, 50)}..."`,
      );
      this.logger.log(
        `⚙️  Configuração RAG: ragEnabled=${ragEnabled}, ragAiEnabled=${aiSettings.ragAiEnabled}, threshold=${aiSettings.ragThreshold}`,
      );
      this.logger.log(
        `🔍 [DEBUG] aiSettings.ragEnabled=${aiSettings.ragEnabled}, this.ragService=${!!this.ragService}, gastoCertoId=${user.gastoCertoId}`,
      );

      if (ragEnabled) {
        try {
          const ragThreshold = aiSettings.ragThreshold || 0.6; // Reduzido de 0.65 para 0.60
          this.logger.log(`🔍 FASE 1: Tentando RAG primeiro...`);

          let ragMatches: any[] = [];

          // Decidir: BM25 ou Embeddings de IA
          if (aiSettings.ragAiEnabled) {
            // NOVO: Busca vetorial com embeddings de IA
            this.logger.log(`🤖 Usando busca vetorial com IA (${aiSettings.ragAiProvider})...`);

            // 🆕 Detectar tipo de transação da mensagem antes do RAG
            const detectedType = await this.detectTransactionType(text);

            // Obter AI provider configurado para RAG
            const ragProvider = await this.aiFactory.getProvider(
              aiSettings.ragAiProvider || 'openai',
            );

            ragMatches = await this.ragService.findSimilarCategoriesWithEmbeddings(
              text,
              user.gastoCertoId,
              ragProvider,
              { minScore: 0.4, maxResults: 3, transactionType: detectedType },
            );
          } else {
            // Original: Busca BM25 (sem IA)
            this.logger.log(`📊 Usando busca BM25 (sem IA)...`);

            // 🆕 Detectar tipo de transação da mensagem antes do RAG
            const detectedType = await this.detectTransactionType(text);

            this.logger.log(
              `📊 [DEBUG] Chamando ragService.findSimilarCategories com userId=${user.gastoCertoId}, text="${text}", type=${detectedType}`,
            );

            ragMatches = await this.ragService.findSimilarCategories(text, user.gastoCertoId, {
              minScore: 0.4,
              maxResults: 3,
              transactionType: detectedType, // 🔥 Filtrar por tipo!
            });

            this.logger.log(
              `📊 [DEBUG] ragService.findSimilarCategories retornou ${ragMatches.length} matches`,
            );
          }

          if (ragMatches.length > 0 && ragMatches[0].score >= ragThreshold) {
            const bestMatch = ragMatches[0];
            this.logger.log(
              `✅ RAG encontrou match direto: "${bestMatch.categoryName}" ` +
                `${bestMatch.subCategoryName ? `> ${bestMatch.subCategoryName}` : ''} ` +
                `(score: ${(bestMatch.score * 100).toFixed(1)}%)`,
            );

            // Usar extractBasicData + TemporalParser (sem chamar IA)
            extractedData = this.extractBasicData(text);
            extractedData.category = bestMatch.categoryName;
            extractedData.subCategory = bestMatch.subCategoryName || null;
            extractedData.confidence = bestMatch.score;
            extractedData.source = aiSettings.ragAiEnabled ? 'RAG_AI_DIRECT' : 'RAG_DIRECT';
          } else {
            this.logger.log(
              `⚠️ RAG score baixo (${ragMatches[0]?.score ? (ragMatches[0].score * 100).toFixed(1) : 0}% < ${ragThreshold * 100}%) - Usando IA...`,
            );
          }
        } catch (ragError) {
          this.logger.warn(`⚠️ Erro no RAG fase 1 (não bloqueante):`, ragError);
        }
      }

      // 3. FASE 2: Se RAG não funcionou, usar IA
      if (!extractedData) {
        this.logger.log(`🤖 FASE 2: Chamando IA para extrair transação...`);
        this.logger.debug(
          `📝 UserContext enviado para IA: ` +
            `name=${userContext.name}, ` +
            `categories=${userContext.categories.length}`,
        );
        const startTime = Date.now();
        extractedData = await this.aiFactory.extractTransaction(text, userContext);
        responseTime = Date.now() - startTime;
        this.logger.log(
          `✅ IA retornou: ${extractedData.type} | ${extractedData.category}${extractedData.subCategory ? ` > ${extractedData.subCategory}` : ''} | Confidence: ${(extractedData.confidence * 100).toFixed(1)}%`,
        );

        // 3.5. FASE 3: Revalidar categoria da IA com RAG
        if (ragEnabled && extractedData.category) {
          try {
            const ragThreshold = aiSettings.ragThreshold || 0.6; // Reduzido para 0.60
            this.logger.log(`🔍 FASE 3: Revalidando categoria da IA com RAG...`);

            // 🆕 Detectar tipo antes de revalidar com RAG
            const detectedType = await this.detectTransactionType(text);

            const ragMatches = await this.ragService.findSimilarCategories(
              text,
              user.gastoCertoId,
              {
                minScore: 0.5,
                maxResults: 1,
                transactionType: detectedType, // 🔥 Filtrar por tipo!
              },
            );

            if (ragMatches.length > 0 && ragMatches[0].score >= ragThreshold) {
              const bestMatch = ragMatches[0];

              // RAG sempre substitui categoria E subcategoria quando score >= threshold
              const changedCategory = extractedData.category !== bestMatch.categoryName;
              const changedSubCategory = extractedData.subCategory !== bestMatch.subCategoryName;

              if (changedCategory || changedSubCategory) {
                this.logger.log(
                  `🧠 RAG melhorou extração da IA: ` +
                    `"${extractedData.category}${extractedData.subCategory ? ` > ${extractedData.subCategory}` : ''}" → ` +
                    `"${bestMatch.categoryName}${bestMatch.subCategoryName ? ` > ${bestMatch.subCategoryName}` : ''}" ` +
                    `(score: ${(bestMatch.score * 100).toFixed(1)}%)`,
                );
              }

              extractedData.category = bestMatch.categoryName;
              extractedData.subCategory = bestMatch.subCategoryName; // SEMPRE substitui
              extractedData.confidence = Math.min(
                extractedData.confidence + bestMatch.score * 0.1,
                1.0,
              );
              extractedData.source = 'AI_RAG_VALIDATED';
            } else {
              extractedData.source = 'AI_ONLY';
            }
          } catch (ragError) {
            this.logger.warn(`⚠️ Erro no RAG fase 3 (não bloqueante):`, ragError);
            extractedData.source = 'AI_ONLY';
          }
        } else {
          extractedData.source = 'AI_ONLY';
        }
      } else {
        // 🚨 RAG está desabilitado - avisar
        this.logger.warn(
          `⚠️ RAG DESABILITADO - Tabela rag_search_logs não será preenchida | ` +
            `Para habilitar: UPDATE "AISettings" SET "ragEnabled" = true;`,
        );
      }

      // Log de extração
      this.logger.log(
        `✅ Transação extraída (${extractedData.source || 'unknown'}) | ` +
          `Tipo: ${extractedData.type} | ` +
          `Valor: R$ ${extractedData.amount} | ` +
          `Categoria: ${extractedData.category}${extractedData.subCategory ? ` > ${extractedData.subCategory}` : ' (sem subcategoria)'} | ` +
          `Confiança: ${(extractedData.confidence * 100).toFixed(1)}%`,
      );

      // ✨ NOVO: Detectar parcelamento, transação fixa e cartão de crédito
      this.logger.log(`🔍 Iniciando detecções avançadas...`);

      // 1. Detectar parcelamento
      const installmentDetection = this.installmentParser.detectInstallments(text);
      this.logger.debug(`🔍 Detecção de parcelamento: ${JSON.stringify(installmentDetection)}`);

      // 2. Detectar transação fixa
      const fixedDetection = this.fixedParser.detectFixed(text);
      this.logger.debug(`🔍 Detecção de fixa: ${JSON.stringify(fixedDetection)}`);

      // 3. Detectar cartão de crédito
      const creditCardDetection = this.creditCardParser.detectCreditCard(text);
      this.logger.debug(`🔍 Detecção de cartão: ${JSON.stringify(creditCardDetection)}`);

      // 4. Enriquecer dados extraídos com detecções
      if (installmentDetection.isInstallment) {
        extractedData.installments = installmentDetection.installments;
        extractedData.installmentNumber = 1;
        this.logger.log(
          `💳 Parcelamento detectado: ${installmentDetection.installments}x` +
            ` (padrão: "${installmentDetection.matchedPattern}")`,
        );
      }

      if (fixedDetection.isFixed) {
        extractedData.isFixed = true;
        extractedData.fixedFrequency = fixedDetection.frequency;
        this.logger.log(
          `🔁 Transação fixa detectada: ${fixedDetection.frequency}` +
            ` (keywords: ${fixedDetection.matchedKeywords?.join(', ')})`,
        );
      }

      if (creditCardDetection.usesCreditCard) {
        // 💳 VALIDAÇÃO DE CARTÃO: Verificar cartões disponíveis e aplicar regras
        const cardValidation = await this.validateCreditCardUsage(user, activeAccountId);

        if (!cardValidation.success) {
          // Retornar erro se não passou na validação
          return {
            success: false,
            message: cardValidation.message,
            requiresConfirmation: false,
          };
        }

        extractedData.creditCardId = cardValidation.creditCardId;
        this.logger.log(
          `💳 Cartão de crédito validado` +
            ` (keywords: ${creditCardDetection.matchedKeywords?.join(', ')})` +
            ` | creditCardId: ${cardValidation.creditCardId}` +
            ` | ${cardValidation.wasAutoSet ? 'AUTO-SET' : 'DEFAULT'}`,
        );
      }

      // 5. Calcular mês da fatura (se for cartão de crédito)
      let invoiceMonth: string | undefined;
      let invoiceMonthFormatted: string | undefined;

      if (extractedData.creditCardId) {
        try {
          const closingDay = await this.invoiceCalculator.getCardClosingDay(
            user.id,
            extractedData.creditCardId,
          );

          const invoiceCalc = this.invoiceCalculator.calculateInvoiceMonth(
            extractedData.date || new Date().toISOString(),
            closingDay,
          );

          invoiceMonth = invoiceCalc.invoiceMonth;
          invoiceMonthFormatted = invoiceCalc.invoiceMonthFormatted;
          extractedData.invoiceMonth = invoiceMonth;

          this.logger.log(
            `📅 Fatura calculada: ${invoiceMonthFormatted}` +
              ` (Fechamento dia ${closingDay}, transação: ${invoiceCalc.isAfterClosing ? 'APÓS' : 'ANTES'} do fechamento)`,
          );
        } catch (error) {
          this.logger.error(`❌ Erro ao calcular mês da fatura:`, error);
        }
      }

      // 6. Determinar status de pagamento
      const statusDecision = this.paymentStatusResolver.resolvePaymentStatus(
        extractedData,
        invoiceMonth,
        invoiceMonthFormatted,
      );
      extractedData.paymentStatus = statusDecision.status;

      this.logger.log(
        `✅ Status determinado: ${statusDecision.status}` +
          ` (${statusDecision.reason})` +
          ` | Requer confirmação obrigatória: ${statusDecision.requiresConfirmation}`,
      );

      // 7. Forçar confidence baixa se requer confirmação obrigatória
      if (statusDecision.requiresConfirmation) {
        // Garantir que NÃO será auto-registrada
        extractedData.confidence = Math.min(extractedData.confidence, 0.75);
        this.logger.log(
          `⚠️ Confirmação obrigatória: confidence ajustada de ${((extractedData.confidence || 0) * 100).toFixed(1)}% para máx 75%`,
        );
      }

      // Registrar uso de IA apenas se foi usada
      if (usedAI) {
        await this.logAIUsage({
          phoneNumber,
          userId: user.id,
          operation: 'TRANSACTION_EXTRACTION',
          inputType: 'TEXT',
          inputText: text,
          responseTimeMs: responseTime,
          extractedData,
        });
      }

      // 3. Validar dados extraídos e verificar confiança
      const validationResult = this.validateAndCheckConfidence(extractedData);
      if (!validationResult.isValid) {
        return {
          success: false,
          message: validationResult.message,
          requiresConfirmation: false,
        };
      }

      // 3.5. Resolver categoria/subcategoria ANTES do aprendizado (para ter IDs corretos)
      const resolved = await this.resolveCategoryAndSubcategory(
        user.gastoCertoId,
        activeAccountId,
        extractedData.category,
        extractedData.subCategory,
        extractedData.type,
      );

      // Enriquecer extractedData com IDs resolvidos
      extractedData.categoryId = resolved.categoryId;
      extractedData.subCategoryId = resolved.subCategoryId;

      // 4. 🎓 Verificar se precisa de aprendizado (detecção de termo desconhecido)
      this.logger.debug(
        `🎓 [DEBUG] Verificando aprendizado: messageLearningService=${!!this.messageLearningService}`,
      );

      // 🔒 SKIP LEARNING se já confirmou (evita loop infinito)
      if (!skipLearning && this.messageLearningService) {
        this.logger.debug(
          `🎓 [DEBUG] Chamando detectAndPrepareConfirmation com: phoneNumber=${phoneNumber}, text="${text}", categoryId=${extractedData.categoryId}`,
        );

        const learningResult = await this.messageLearningService.detectAndPrepareConfirmation(
          phoneNumber,
          text,
          extractedData,
        );

        this.logger.debug(
          `🎓 [DEBUG] Resultado do aprendizado: needsConfirmation=${learningResult.needsConfirmation}`,
        );

        if (learningResult.needsConfirmation) {
          this.logger.log(
            `🎓 Termo desconhecido detectado para ${phoneNumber} - Enviando confirmação de aprendizado`,
          );
          return {
            success: true,
            message: learningResult.message,
            requiresConfirmation: true,
            confirmationId: 'learning',
          };
        }
      } else if (skipLearning) {
        this.logger.log(
          `🔒 [SKIP LEARNING] Processando transação após confirmação - AUTO-CONFIRMAR e ENVIAR`,
        );

        // Criar confirmação
        const confirmResult = await this.createConfirmation(
          phoneNumber,
          extractedData,
          messageId,
          user,
          platform,
          activeAccountId, // Passar accountId contextual
        );

        if (!confirmResult.success || !confirmResult.confirmationId) {
          this.logger.error(`❌ Falha ao criar confirmação para auto-envio`);
          return confirmResult;
        }

        // Confirmar imediatamente (mudar status PENDING → CONFIRMED)
        const confirmed = await this.confirmationService.confirm(confirmResult.confirmationId);
        this.logger.log(`✅ Confirmação ${confirmed.id} auto-confirmada (skipLearning)`);

        // Enviar para API
        const sendResult = await this.registerConfirmedTransaction(confirmed);

        return {
          success: sendResult.success,
          message: sendResult.message,
          requiresConfirmation: false,
          confirmationId: confirmed.id,
        };
      } else {
        this.logger.warn(`⚠️ MessageLearningService não está disponível!`);
      }

      // 5. Sempre criar confirmação (a lógica de auto-register está no createConfirmation)
      return await this.createConfirmation(
        phoneNumber,
        extractedData,
        messageId,
        user,
        platform,
        activeAccountId, // Passar accountId contextual
      );
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
    platform: string = 'whatsapp',
    accountId?: string, // accountId contextual passado pelo provider
  ): Promise<{
    success: boolean;
    message: string;
    requiresConfirmation: boolean;
    confirmationId?: string;
  }> {
    try {
      this.logger.log(`🖼️ [Registration] Processando imagem de ${phoneNumber}`);

      // 0. Usar accountId passado (OBRIGATÓRIO - não busca do cache)
      if (!accountId) {
        this.logger.error(`❌ AccountId não fornecido para ${phoneNumber}`);
        return {
          success: false,
          message: '❌ Erro interno: conta não identificada.',
          requiresConfirmation: false,
        };
      }

      const activeAccountId = accountId;
      this.logger.debug(`🏦 Usando accountId: ${activeAccountId}`);

      // 1. Extrair dados da imagem via IA
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
      await this.logAIUsage({
        phoneNumber,
        userId: user.id,
        operation: 'IMAGE_ANALYSIS',
        inputType: 'IMAGE',
        inputText: `Image: ${mimeType}`,
        responseTimeMs: responseTime,
        extractedData,
        imageSize: imageBuffer.length,
        mimeType,
      });

      // 3. Validar dados
      const validationResult = this.validateAndCheckConfidence(extractedData);
      if (!validationResult.isValid) {
        return {
          success: false,
          message: validationResult.message,
          requiresConfirmation: false,
        };
      }

      // 3.1. Verificar se categoria é vaga/genérica E se não há descrição clara
      const vagueCategories = [
        'outros',
        'diversos',
        'geral',
        'sem categoria',
        'indefinido',
        'não identificado',
        'desconhecido',
      ];

      const categoryIsVague =
        !extractedData.category ||
        vagueCategories.some((vague) => extractedData.category?.toLowerCase().includes(vague));

      const descriptionIsEmpty =
        !extractedData.description || extractedData.description.trim().length < 5;

      // Se categoria vaga E sem descrição, perguntar ao usuário
      if (categoryIsVague && descriptionIsEmpty && extractedData.confidence < 0.7) {
        this.logger.log(
          `❓ Categoria vaga (${extractedData.category}) e sem descrição - pedindo esclarecimento`,
        );

        const questionMessage =
          '❓ *Consegui extrair o valor, mas preciso de mais informações!*\n\n' +
          `💵 *Valor encontrado:* R$ ${extractedData.amount.toFixed(2)}\n\n` +
          '📝 *Poderia me dizer sobre o que foi esse gasto?*\n\n' +
          '_Exemplo: "Foi no supermercado" ou "Conta de luz"_';

        return {
          success: false,
          message: questionMessage,
          requiresConfirmation: false,
        };
      }

      // 4. Sempre pedir confirmação para imagens (mesmo com alta confiança)
      return await this.createConfirmation(
        phoneNumber,
        extractedData,
        messageId,
        user,
        platform,
        activeAccountId, // Passar accountId contextual
      );
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
    platform: string = 'whatsapp',
    accountId?: string, // accountId contextual passado pelo provider
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
      const startTime = Date.now();
      const transcription = await this.aiFactory.transcribeAudio(audioBuffer, mimeType);
      const responseTime = Date.now() - startTime;

      this.logger.log(`📝 Transcrição: "${transcription}"`);

      // ✅ Registrar uso de IA para transcrição de áudio
      await this.logAIUsage({
        phoneNumber,
        userId: user.id,
        operation: 'AUDIO_TRANSCRIPTION',
        inputType: 'AUDIO',
        inputText: `Audio: ${mimeType} (${audioBuffer.length} bytes)`,
        responseTimeMs: responseTime,
        mimeType,
        imageSize: audioBuffer.length, // Reutilizar campo para tamanho do áudio
      });

      // 2. Processar como texto (que vai registrar outro uso de IA se necessário)
      return await this.processTextTransaction(
        phoneNumber,
        transcription,
        messageId,
        user,
        platform,
        accountId, // Passar accountId contextual
      );
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
    platform: string = 'whatsapp',
    accountId?: string, // accountId contextual
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

      if (result.success) {
        const typeEmoji = data.type === 'EXPENSES' ? '💸' : '💰';
        const typeText = data.type === 'EXPENSES' ? 'Gasto' : 'Receita';
        const subcategoryText = data.subCategory ? ` > ${data.subCategory}` : '';

        return {
          success: true,
          message:
            `✅ *${typeText} registrado automaticamente!*\n\n` +
            `${typeEmoji} *Valor:* R$ ${data.amount.toFixed(2)}\n` +
            `📂 *Categoria:* ${data.category}${subcategoryText}\n` +
            `${data.description ? `📝 *Descrição:* ${data.description}\n` : ''}` +
            `${data.date ? `📅 *Data:* ${DateUtil.formatBR(DateUtil.normalizeDate(data.date))}\n` : ''}\n` +
            `🎯 *Confiança:* ${(data.confidence * 100).toFixed(0)}%`,
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
      const confirmation = await this.createConfirmation(
        phoneNumber,
        data,
        messageId,
        user,
        platform,
        accountId, // Passar accountId contextual (se disponível)
      );
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
    platform: string = 'whatsapp',
    accountId?: string, // accountId contextual (se não fornecido, busca do cache)
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

      // Usar accountId passado (OBRIGATÓRIO - não busca do cache)
      if (!accountId) {
        this.logger.error(
          `❌ AccountId não fornecido em createConfirmation para ${phoneNumber}`,
        );
        throw new Error('AccountId é obrigatório para criar confirmação');
      }

      const finalAccountId = accountId;

      // 🔍 LOG DE DEBUG: Rastrear conta sendo usada
      this.logger.log(
        `👤 [PERFIL DEBUG] Conta para transação: ` +
          `phoneNumber=${phoneNumber}, ` +
          `accountId=${finalAccountId}, ` +
          `userId=${user?.gastoCertoId || 'N/A'}`,
      );

      // Resolver IDs de categoria e subcategoria ANTES de criar confirmação
      let categoryId: string | undefined;
      let subCategoryId: string | undefined;

      if (user && finalAccountId) {
        try {
          this.logger.debug(
            `📊 [DEBUG] Dados extraídos ANTES de resolver IDs: category="${data.category}", subCategory="${data.subCategory}"`,
          );

          const resolved = await this.resolveCategoryAndSubcategory(
            user.gastoCertoId,
            finalAccountId,
            data.category,
            data.subCategory,
            data.type, // ⭐ Passar tipo da transação para filtrar categorias
          );
          categoryId = resolved.categoryId || undefined;
          subCategoryId = resolved.subCategoryId || undefined;

          this.logger.log(
            `📂 IDs resolvidos (tipo: ${data.type}): ` +
              `Categoria "${data.category}" → ${categoryId || 'não encontrada'} | ` +
              `Subcategoria "${data.subCategory || 'nenhuma'}" → ${subCategoryId || 'não encontrada'}`,
          );

          // 🚀 AUTO-REGISTER: Se categoryId E subCategoryId estão resolvidos + confiança >= threshold
          // Registrar automaticamente sem pedir confirmação
          if (categoryId && subCategoryId && data.confidence >= this.autoRegisterThreshold) {
            this.logger.log(
              `⚡ AUTO-REGISTER ativado: categoryId + subCategoryId resolvidos + confiança ${(data.confidence * 100).toFixed(1)}% >= ${(this.autoRegisterThreshold * 100).toFixed(0)}%`,
            );

            // Registrar imediatamente
            const tempConfirmation = {
              phoneNumber,
              type: data.type,
              amount: Math.round(data.amount * 100),
              category: data.category,
              categoryId,
              subCategoryId,
              accountId: finalAccountId,
              description: data.description,
              date: validDate,
              extractedData: {
                merchant: data.merchant,
                confidence: data.confidence,
                subcategory: data.subCategory,
              },
            };

            const result = await this.sendTransactionToApi(tempConfirmation, data);

            if (result.success) {
              const typeEmoji = data.type === 'EXPENSES' ? '💸' : '💰';

              // 👤 Buscar nome da conta ativa
              let accountName = 'Conta não identificada';
              if (user.accounts && Array.isArray(user.accounts)) {
                const accounts = user.accounts as Array<{
                  id: string;
                  name: string;
                  type?: string;
                  isPrimary?: boolean;
                }>;
                const activeAcc = accounts.find((acc) => acc.id === finalAccountId);
                if (activeAcc) {
                  accountName = activeAcc.name;
                }
              }

              // Formatar data para exibição
              const formattedDate = validDate.toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              });

              // Formatar perfil temporal
              const temporalProfile = data.temporalInfo?.profile || 'TODAY';
              const temporalText = this.formatTemporalProfile(temporalProfile);

              return {
                success: true,
                message:
                  `${typeEmoji} *Transação registrada com sucesso!*\n\n` +
                  `💵 *Valor:* R$ ${data.amount.toFixed(2)}\n` +
                  `📂 *Categoria:* ${data.category}${data.subCategory ? ` > ${data.subCategory}` : ''}\n` +
                  `${data.description ? `📝 ${data.description}\n` : ''}` +
                  `📅 *Data:* ${formattedDate} (${temporalText})\n` +
                  `👤 *Perfil:* ${accountName}\n`,
                // `🤖 _Registrado com ${(data.confidence * 100).toFixed(1)}% de confiança_`,
                requiresConfirmation: false,
                confirmationId: '',
              };
            }
            // Se falhar, continua para confirmação manual
            this.logger.warn(
              `⚠️ Auto-register falhou, continuando para confirmação manual: ${result.error}`,
            );
          }
        } catch (error) {
          this.logger.warn(`⚠️ Erro ao resolver categoria (continuando): ${error.message}`);
        }
      }

      const dto: CreateTransactionConfirmationDto = {
        phoneNumber,
        platform, // Usar platform da mensagem
        userId: user?.id, // Incluir userId se user disponível
        accountId: finalAccountId, // Incluir accountId contextual ou do cache
        messageId,
        type: data.type as any,
        amount: amountInCents,
        category: data.category,
        categoryId, // ID resolvido da categoria
        subCategoryId, // ID resolvido da subcategoria
        subCategoryName: data.subCategory || null, // Nome da subcategoria
        description: data.description,
        date: validDate,
        extractedData: {
          merchant: data.merchant,
          confidence: data.confidence,
          subcategory: data.subCategory,
        },
        // 📦 Novos campos para transações avançadas
        isFixed: data.isFixed || undefined,
        fixedFrequency: data.fixedFrequency || undefined,
        installments: data.installments || undefined,
        installmentNumber: data.installmentNumber || undefined,
        creditCardId: data.creditCardId || undefined,
        paymentStatus: data.paymentStatus || undefined,
        invoiceMonth: data.invoiceMonth || undefined,
      };

      const confirmation = await this.confirmationService.create(dto);

      const typeEmoji = data.type === 'EXPENSES' ? '💸' : '💰';
      const typeText = data.type === 'EXPENSES' ? 'Gasto' : 'Receita';

      // Formatar categoria com subcategoria
      const categoryText = data.subCategory
        ? `${data.category} > ${data.subCategory}`
        : `${data.category}\n📂 *Subcategoria:* Não encontrada`;

      // 👤 Buscar nome da conta ativa do usuário
      let accountName = 'Conta não identificada';
      if (user.accounts && Array.isArray(user.accounts) && accountId) {
        const accounts = user.accounts as Array<{
          id: string;
          name: string;
          type?: string;
          isPrimary?: boolean;
        }>;
        const activeAccount = accounts.find((acc) => acc.id === accountId);
        if (activeAccount) {
          accountName = activeAccount.name;
        }
      }

      // 📦 Informações adicionais para transações especiais
      let additionalInfo = '';

      // Transação parcelada
      if (data.installments && data.installments > 1) {
        const installmentValue = data.amount / data.installments;
        additionalInfo += `\n💳 *Parcelamento:* ${data.installments}x de R$ ${installmentValue.toFixed(2)}`;
        if (data.installmentNumber) {
          additionalInfo += ` (parcela ${data.installmentNumber}/${data.installments})`;
        }
      }

      // Transação fixa/recorrente
      if (data.isFixed && data.fixedFrequency) {
        const frequencyMap = {
          MONTHLY: 'Mensal',
          WEEKLY: 'Semanal',
          ANNUAL: 'Anual',
          BIENNIAL: 'Bienal',
        };
        additionalInfo += `\n🔄 *Recorrência:* ${frequencyMap[data.fixedFrequency] || data.fixedFrequency}`;
      }

      // Transação no cartão de crédito
      if (data.creditCardId && data.invoiceMonth) {
        additionalInfo += `\n💳 *Cartão de Crédito*`;
        additionalInfo += `\n📅 *Fatura:* ${data.invoiceMonth}`;
      }

      // Status do pagamento
      if (data.paymentStatus === 'PENDING') {
        additionalInfo += `\n⏳ *Status:* Pendente`;
      }

      return {
        success: true,
        message:
          `${typeEmoji} *Confirmar ${typeText}?*\n\n` +
          `💵 *Valor:* R$ ${data.amount.toFixed(2)}\n` +
          `📂 *Categoria:* ${categoryText}\n` +
          `${data.description ? `📝 *Descrição:* ${data.description}\n` : ''}` +
          `${data.date ? `📅 *Data:* ${DateUtil.formatBR(validDate)}\n` : ''}` +
          `${data.merchant ? `🏪 *Local:* ${data.merchant}\n` : ''}` +
          `👤 *Perfil:* ${accountName}` +
          additionalInfo + // Adiciona informações de parcelas/fixa/cartão
          `\n\n✅ Digite *"sim"* para confirmar\n` +
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
   * � FASE 8: Cria próximas ocorrências para transações fixas/recorrentes
   *
   * Quando o usuário confirma uma transação fixa (ex: assinatura mensal), este método:
   * 1. Determina a frequência (MONTHLY, WEEKLY, ANNUAL, BIENNIAL)
   * 2. Calcula as próximas N datas baseado na frequência
   * 3. Cria transações futuras na API
   * 4. Limite padrão: 6 meses (ou 26 semanas se semanal)
   */
  private async createRecurringOccurrences(confirmation: any): Promise<void> {
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
          date: occurrence.date.toISOString().split('T')[0], // YYYY-MM-DD
          source: confirmation.platform || 'whatsapp',
        };

        try {
          const response = await this.gastoCertoApi.createTransaction(dto);
          this.logger.log(
            `✅ [RECURRING] Ocorrência ${occurrence.occurrenceNumber} criada: ${occurrence.date.toISOString().split('T')[0]}`,
          );

          // Opcional: Salvar no banco para rastreamento
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
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h de expiração
              apiSent: true,
              apiSentAt: new Date(),
              // Campos de recorrência
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
   * Determina quantas ocorrências futuras criar baseado na frequência
   */
  private getOccurrencesLimit(frequency: string): number {
    switch (frequency) {
      case 'WEEKLY':
        return 12; // 12 semanas = ~3 meses
      case 'MONTHLY':
        return 6; // 6 meses
      case 'ANNUAL':
        return 2; // 2 anos
      case 'BIENNIAL':
        return 1; // 1 ocorrência (daqui a 2 anos)
      default:
        return 6;
    }
  }

  /**
   * Calcula a data da próxima ocorrência baseado na frequência
   */
  private calculateNextOccurrenceDate(
    baseDate: Date,
    frequency: string,
    incrementCount: number,
  ): Date {
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
  private formatFrequency(frequency: string): string {
    const frequencyMap: Record<string, string> = {
      WEEKLY: 'Semanal',
      MONTHLY: 'Mensal',
      ANNUAL: 'Anual',
      BIENNIAL: 'Bienal',
    };
    return frequencyMap[frequency] || frequency;
  }

  /**
   * �📦 FASE 7: Cria parcelas adicionais para transações parceladas
   *
   * Quando o usuário confirma uma transação parcelada (ex: 4x), este método:
   * 1. Calcula as datas das próximas parcelas (incrementa mês a mês)
   * 2. Cria N-1 transações adicionais na API (primeira já foi criada)
   * 3. Cada parcela tem seu próprio installmentNumber (2/4, 3/4, 4/4)
   * 4. Se for cartão, calcula o mês da fatura para cada parcela
   */
  private async createAdditionalInstallments(confirmation: any): Promise<void> {
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
          // Buscar dia de fechamento do cartão
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
          amount: confirmation.amount, // Mesmo valor para cada parcela
          description: confirmation.description
            ? `${confirmation.description} (${installment.installmentNumber}/${totalInstallments})`
            : `Parcela ${installment.installmentNumber}/${totalInstallments}`,
          date: installment.date.toISOString().split('T')[0], // YYYY-MM-DD
          source: confirmation.platform || 'whatsapp', // Campo obrigatório
        };

        try {
          const response = await this.gastoCertoApi.createTransaction(dto);
          this.logger.log(
            `✅ [INSTALLMENTS] Parcela ${installment.installmentNumber}/${totalInstallments} criada com sucesso`,
          );

          // Opcional: Salvar no banco para rastreamento
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
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h de expiração
              apiSent: true,
              apiSentAt: new Date(),
              // Campos de parcelamento
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
   * Registra transação confirmada pelo usuário na API GastoCerto
   */
  async registerConfirmedTransaction(
    confirmation: any,
  ): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.log(`💾 [Registration] Registrando transação confirmada ID: ${confirmation.id}`);

      // Enviar para API usando método genérico
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

        // 📦 FASE 7: Criar parcelas adicionais se transação for parcelada
        if (confirmation.installments && confirmation.installments > 1) {
          await this.createAdditionalInstallments(confirmation);
        }

        // 🔄 FASE 8: Criar próximas ocorrências se transação for fixa/recorrente
        if (confirmation.isFixed && confirmation.fixedFrequency) {
          await this.createRecurringOccurrences(confirmation);
        }

        const typeEmoji = confirmation.type === 'EXPENSES' ? '💸' : '💰';
        const subCategoryText = confirmation.subCategoryName
          ? ` > ${confirmation.subCategoryName}`
          : '';

        // 👤 Buscar nome da conta da confirmação
        let accountName = 'Conta não identificada';
        if (confirmation.accountId) {
          const userCache = await this.userCache.getUser(confirmation.phoneNumber);
          if (userCache?.accounts && Array.isArray(userCache.accounts)) {
            const accounts = userCache.accounts as Array<{
              id: string;
              name: string;
              type?: string;
              isPrimary?: boolean;
            }>;
            const account = accounts.find((acc) => acc.id === confirmation.accountId);
            if (account) {
              accountName = account.name;
            }
          }
        }

        // Formatar data para exibição
        const transactionDate = new Date(confirmation.date);
        const formattedDate = transactionDate.toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        });

        // Tentar extrair perfil temporal do extractedData
        let temporalText = 'hoje';
        try {
          const extractedData =
            typeof confirmation.extractedData === 'string'
              ? JSON.parse(confirmation.extractedData)
              : confirmation.extractedData;
          const temporalProfile = extractedData?.temporalInfo?.profile || 'TODAY';
          temporalText = this.formatTemporalProfile(temporalProfile);
        } catch (error) {
          // Ignorar erro de parsing
        }

        const successMessage =
          `${typeEmoji} *Transação registrada com sucesso!*\n\n` +
          `💵 *Valor:* R$ ${(Number(confirmation.amount) / 100).toFixed(2)}\n` +
          `📂 *Categoria:* ${confirmation.category}${subCategoryText}\n` +
          `${confirmation.description ? `📝 ${confirmation.description}\n` : ''}` +
          `📅 *Data:* ${formattedDate} (${temporalText})\n` +
          `👤 *Perfil:* ${accountName}`;

        return {
          success: true,
          message: successMessage,
        };
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

      // 2. Buscar conta da transação (usar a conta salva na confirmação ou a conta ativa atual)
      let activeAccount;

      if (confirmation.accountId) {
        // Se a confirmação tem accountId salvo, buscar essa conta específica
        this.logger.log(`📌 Usando conta salva na confirmação: ${confirmation.accountId}`);
        const userCache = await this.userCache.getUser(confirmation.phoneNumber);
        if (userCache?.accounts && Array.isArray(userCache.accounts)) {
          activeAccount = (userCache.accounts as any[]).find(
            (acc: any) => acc.id === confirmation.accountId,
          );
        }
      } else {
        // Fallback: buscar conta ativa atual (para confirmações antigas sem accountId)
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

      // Verificar se já temos IDs salvos na confirmação (preferência)
      if (confirmation.categoryId) {
        categoryId = confirmation.categoryId;
        subCategoryId = confirmation.subCategoryId || null;
        this.logger.log(
          `📂 Usando IDs salvos: categoryId=${categoryId}, subCategoryId=${subCategoryId || 'null'}`,
        );
      } else {
        // Fallback: resolver categoria pelo nome (para confirmações antigas)
        this.logger.log(
          `🔍 Confirmação sem categoryId, resolvendo pelo nome (tipo: ${confirmation.type})...`,
        );
        const resolved = await this.resolveCategoryAndSubcategory(
          user.gastoCertoId,
          accountId,
          confirmation.category,
          confirmation.extractedData?.subcategory || data?.subCategory,
          confirmation.type, // ⭐ Passar tipo da transação para filtrar categorias
        );
        categoryId = resolved.categoryId;
        subCategoryId = resolved.subCategoryId;
      }

      if (!categoryId) {
        return {
          success: false,
          error: 'Categoria não encontrada',
        };
      }

      // 4. Preparar DTO para API
      const description =
        confirmation.description || data?.description || confirmation.extractedData?.description;

      const merchant = confirmation.extractedData?.merchant || data?.merchant;

      const dto: CreateGastoCertoTransactionDto = {
        userId: user.gastoCertoId,
        accountId, // Adicionar conta default
        type: confirmation.type as TransactionType, // Manter maiúsculo (EXPENSES | INCOME)
        amount: Number(confirmation.amount),
        categoryId,
        subCategoryId,
        ...(description && description.trim() ? { description: description.trim() } : {}), // Só incluir se não estiver vazio
        date: confirmation.date
          ? DateUtil.formatToISO(DateUtil.normalizeDate(confirmation.date))
          : DateUtil.formatToISO(DateUtil.today()),
        ...(merchant && merchant.trim() ? { merchant: merchant.trim() } : {}), // Só incluir se não estiver vazio
        source: confirmation.platform || 'telegram', // ✅ Sources: telegram | whatsapp | webchat
      };

      this.logger.log(`📤 Enviando para GastoCerto API:`, JSON.stringify(dto, null, 2));

      // 5. Registrar na API
      const response = await this.gastoCertoApi.createTransaction(dto);

      if (response.success) {
        // API retorna success: true quando registra com sucesso
        return {
          success: true,
          transactionId: response.transaction?.id || 'unknown',
        };
      } else {
        // Log detalhado do erro da API
        this.logger.error(
          `❌ [API ERROR] Erro ao enviar transação para GastoCerto API:`,
          JSON.stringify(response, null, 2),
        );

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
   * Busca o ID da conta default do usuário
   */
  /**
   * Helper para resolver categoria e subcategoria da conta
   * Busca primeiro no cache local, depois na API se necessário
   * Retorna IDs a partir de nomes ou IDs
   * IMPORTANTE: Filtra categorias pelo tipo da transação (INCOME/EXPENSES)
   */
  private async resolveCategoryAndSubcategory(
    userId: string,
    accountId: string,
    categoryNameOrId: string,
    subcategoryNameOrId?: string,
    transactionType?: 'INCOME' | 'EXPENSES',
  ): Promise<{ categoryId: string | null; subCategoryId: string | null }> {
    this.logger.debug(
      `🔍 [DEBUG] resolveCategoryAndSubcategory chamado com: category="${categoryNameOrId}", subCategory="${subcategoryNameOrId}", type="${transactionType}"`,
    );

    try {
      // Buscar usuário no cache pelo gastoCertoId (userId é o gastoCertoId)
      const user = await this.userCache.getUserByGastoCertoId(userId);

      let categoriesData: any[] = [];

      // 1. PRIORIDADE: Tentar buscar do cache RAG (formato expandido com subcategorias)
      if (this.ragService) {
        try {
          const ragCategories = await this.ragService.getCachedCategories(userId);
          if (ragCategories && ragCategories.length > 0) {
            // Filtrar por conta E tipo de transação
            categoriesData = ragCategories.filter((cat: any) => {
              const matchesAccount = cat.accountId === accountId;
              const matchesType = !transactionType || cat.type === transactionType;
              return matchesAccount && matchesType;
            });

            if (categoriesData.length > 0) {
              this.logger.log(
                `📦 Usando ${categoriesData.length} categoria(s) do cache RAG (formato expandido, tipo: ${transactionType || 'TODOS'})`,
              );
            }
          }
        } catch (error) {
          this.logger.warn(`⚠️ Erro ao buscar do cache RAG: ${error.message}`);
        }
      }

      // 2. Fallback: Buscar do cache do usuário (formato API não expandido)
      if (
        categoriesData.length === 0 &&
        user &&
        user.categories &&
        Array.isArray(user.categories)
      ) {
        const cachedCategories = user.categories as any[];

        // Filtrar categorias da conta específica E tipo de transação
        categoriesData = cachedCategories.filter((cat: any) => {
          const matchesAccount = cat.accountId === accountId;
          const matchesType = !transactionType || cat.type === transactionType;
          return matchesAccount && matchesType;
        });

        if (categoriesData.length > 0) {
          this.logger.log(
            `📦 Usando ${categoriesData.length} categoria(s) do cache local do usuário (tipo: ${transactionType || 'TODOS'})`,
          );
        } else {
          this.logger.warn(
            `⚠️ Cache tem categorias mas nenhuma da conta ${accountId} e tipo ${transactionType}. Total no cache: ${cachedCategories.length}`,
          );
        }
      }

      // 3. Último recurso: Buscar na API
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

        // DEBUG: Listar categorias disponíveis
        const available = categoriesData
          .map((c: any) => `${c.name} (tipo: ${c.type || 'N/A'})`)
          .join(', ');
        this.logger.warn(`📋 Categorias disponíveis: ${available}`);

        return { categoryId: null, subCategoryId: null };
      }

      const categoryId = matchingCategory.id;
      this.logger.log(`📂 Categoria resolvida: ${categoryNameOrId} → ${categoryId}`);

      // DEBUG: Log completo da estrutura da categoria encontrada
      this.logger.debug(
        `🔍 [DEBUG] Categoria encontrada - Estrutura completa: ${JSON.stringify(matchingCategory, null, 2).substring(0, 500)}`,
      );

      // 4. Se não há subcategoria informada, retornar apenas categoria
      if (!subcategoryNameOrId) {
        return { categoryId, subCategoryId: null };
      }

      // 5. Procurar subcategoria - suportar DOIS formatos:
      //    a) subCategories: [] (formato da API)
      //    b) subCategory: { id, name } (formato do cache expandido do RAG)
      let subCategoryId: string | null = null;

      // Formato do cache expandido (cada entrada tem UMA subcategoria)
      if (matchingCategory.subCategory && typeof matchingCategory.subCategory === 'object') {
        const subCat = matchingCategory.subCategory;
        if (
          subCat.name.toLowerCase() === subcategoryNameOrId.toLowerCase() ||
          subCat.id === subcategoryNameOrId
        ) {
          subCategoryId = subCat.id;
          this.logger.log(
            `📂 Subcategoria resolvida (cache): ${subcategoryNameOrId} → ${subCategoryId}`,
          );
          return { categoryId, subCategoryId };
        }
      }

      // Formato da API (categoria tem array de subcategorias)
      if (matchingCategory.subCategories && Array.isArray(matchingCategory.subCategories)) {
        this.logger.debug(
          `📋 Procurando em ${matchingCategory.subCategories.length} subcategorias da API...`,
        );

        const matchingSubCategory = matchingCategory.subCategories.find(
          (subCat: any) =>
            subCat.name.toLowerCase() === subcategoryNameOrId.toLowerCase() ||
            subCat.id === subcategoryNameOrId,
        );

        if (matchingSubCategory) {
          subCategoryId = matchingSubCategory.id;
          this.logger.log(
            `📂 Subcategoria resolvida (API): ${subcategoryNameOrId} → ${subCategoryId}`,
          );
          return { categoryId, subCategoryId };
        }
      }

      // Se não encontrou, buscar em TODAS as categorias expandidas do cache
      // (pode haver múltiplas entradas da mesma categoria, cada uma com uma subcategoria diferente)
      const allMatchingCategories = categoriesData.filter(
        (cat: any) =>
          (cat.name.toLowerCase() === categoryNameOrId.toLowerCase() ||
            cat.id === categoryNameOrId) &&
          cat.subCategory &&
          (cat.subCategory.name.toLowerCase() === subcategoryNameOrId.toLowerCase() ||
            cat.subCategory.id === subcategoryNameOrId),
      );

      if (allMatchingCategories.length > 0) {
        subCategoryId = allMatchingCategories[0].subCategory.id;
        this.logger.log(
          `📂 Subcategoria resolvida (busca expandida): ${subcategoryNameOrId} → ${subCategoryId}`,
        );
        return { categoryId, subCategoryId };
      }

      // Não encontrou a subcategoria
      this.logger.warn(
        `⚠️ Subcategoria "${subcategoryNameOrId}" não encontrada na categoria "${matchingCategory.name}"`,
      );

      // DEBUG: Listar subcategorias disponíveis
      if (matchingCategory.subCategories && Array.isArray(matchingCategory.subCategories)) {
        const subCatNames = matchingCategory.subCategories.map((sc: any) => sc.name).join(', ');
        this.logger.warn(`📋 Subcategorias disponíveis (API): ${subCatNames}`);
      }

      // DEBUG: Verificar todas as entradas da categoria no cache
      const allCategoryEntries = categoriesData.filter(
        (cat: any) =>
          cat.name.toLowerCase() === categoryNameOrId.toLowerCase() || cat.id === categoryNameOrId,
      );
      if (allCategoryEntries.length > 1) {
        const subCatNames = allCategoryEntries
          .filter((e: any) => e.subCategory)
          .map((e: any) => e.subCategory.name)
          .join(', ');
        this.logger.warn(`📋 Subcategorias disponíveis (cache): ${subCatNames}`);
      }

      return { categoryId, subCategoryId: null };
    } catch (error: any) {
      this.logger.error(`❌ Erro ao resolver categoria/subcategoria:`, error);
      return { categoryId: null, subCategoryId: null };
    }
  }

  /**
   * Reenvia uma transação pendente usando dados salvos
   * Usado pelo endpoint de reenvio manual
   */
  async resendTransaction(
    confirmationId: string,
  ): Promise<{ success: boolean; error?: string; transactionId?: string }> {
    try {
      this.logger.log(`🔄 Reenviando transação: ${confirmationId}`);

      // 1. Buscar confirmação
      const confirmation = await this.confirmationService.getById(confirmationId);
      if (!confirmation) {
        return { success: false, error: 'Confirmação não encontrada' };
      }

      // 2. Verificar se já foi enviada
      if (confirmation.apiSent) {
        this.logger.warn(`⚠️ Transação ${confirmationId} já foi enviada`);
        return {
          success: true,
        };
      }

      // 3. Reenviar usando dados salvos (accountId, categoryId, subCategoryId)
      const result = await this.sendTransactionToApi(confirmation);

      // 4. Atualizar status
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
   * Log consolidado de uso de IA
   */
  private async logAIUsage(params: {
    phoneNumber: string;
    userId: string;
    operation: 'TRANSACTION_EXTRACTION' | 'IMAGE_ANALYSIS' | 'AUDIO_TRANSCRIPTION';
    inputType: 'TEXT' | 'IMAGE' | 'AUDIO';
    inputText: string;
    responseTimeMs?: number;
    extractedData?: TransactionData;
    imageSize?: number;
    mimeType?: string;
  }): Promise<void> {
    try {
      await this.aiFactory.logAIUsage({
        phoneNumber: params.phoneNumber,
        userCacheId: params.userId,
        operation: params.operation as any,
        inputType: params.inputType as any,
        inputText: params.inputText,
        inputTokens:
          params.inputType === 'IMAGE'
            ? Math.ceil((params.imageSize || 0) / 1000)
            : Math.ceil(params.inputText.length / 4),
        outputTokens: params.extractedData
          ? Math.ceil(JSON.stringify(params.extractedData).length / 4)
          : 0,
        metadata: {
          confidence: params.extractedData?.confidence,
          category: params.extractedData?.category,
          amount: params.extractedData?.amount,
          type: params.extractedData?.type,
          responseTimeMs: params.responseTimeMs,
          imageSize: params.imageSize,
          mimeType: params.mimeType,
        },
      });
    } catch (error) {
      this.logger.error(`⚠️ Erro ao registrar AI usage:`, error);
    }
  }

  /**
   * Valida dados extraídos e verifica confiança mínima
   */
  private validateAndCheckConfidence(data: TransactionData): {
    isValid: boolean;
    message?: string;
  } {
    // 1. Validar dados
    const validation = this.validator.validate(data);
    if (!validation.isValid) {
      this.logger.warn(`❌ Validação falhou: ${validation.errors.join(', ')}`);
      return {
        isValid: false,
        message: this.formatValidationError(validation.errors),
      };
    }

    // 2. Verificar confiança mínima
    if (data.confidence < this.minConfidenceThreshold) {
      this.logger.warn(`⚠️ Confiança muito baixa: ${(data.confidence * 100).toFixed(1)}%`);
      return {
        isValid: false,
        message:
          '❓ *Não entendi bem sua mensagem*\n\n' +
          'Por favor, tente ser mais específico. Exemplo:\n' +
          '_"Gastei R$ 50,00 em alimentação no mercado"_',
      };
    }

    return { isValid: true };
  }

  /**
   * Extrai dados básicos do texto sem usar IA (amount, type, date)
   * Usado quando RAG encontra categoria com alta confiança
   */
  private extractBasicData(text: string): TransactionData {
    const normalized = text.toLowerCase().trim();

    // 1. Detectar tipo (EXPENSES ou INCOME)
    const incomeKeywords = ['recebi', 'ganhei', 'entrada', 'salário', 'pagamento recebido'];
    const type = incomeKeywords.some((kw) => normalized.includes(kw))
      ? TransactionType.INCOME
      : TransactionType.EXPENSES;

    // 2. Extrair valor (regex para capturar R$ 123,45 ou 123.45 ou 123)
    let amount = 0;
    const amountPatterns = [
      /r\$\s*(\d+)[,.](\d{2})/i, // R$ 123,45 ou R$ 123.45
      /(\d+)[,.](\d{2})/, // 123,45 ou 123.45
      /r\$\s*(\d+)/i, // R$ 123
      /(\d+)/, // 123
    ];

    for (const pattern of amountPatterns) {
      const match = normalized.match(pattern);
      if (match) {
        if (match[2]) {
          // Com centavos: 123.45
          amount = parseFloat(`${match[1]}.${match[2]}`);
        } else {
          // Sem centavos: 123
          amount = parseFloat(match[1]);
        }
        break;
      }
    }

    // 3. Detectar data com TemporalParser (suporta expressões complexas)
    const today = new Date();
    let date: Date | string = today;
    let temporalInfo: any = null;

    try {
      // TemporalParser pode detectar:
      // - "ontem", "anteontem", "hoje"
      // - "dia 15", "dia 10 do mês que vem"
      // - "próxima semana", "mês passado"
      // - "início do mês", "fim da semana"
      const analysis = this.temporalParser.parseTemporalExpression(text);
      const parsedDate = this.temporalParser.calculateDate(
        today,
        analysis.timeReference,
        analysis.specificDay,
      );
      date = parsedDate;

      // Salvar informações temporais para exibir ao usuário
      temporalInfo = {
        profile: analysis.timeReference || 'TODAY',
        confidence: analysis.confidence,
        specificDay: analysis.specificDay,
      };

      this.logger.debug(
        `📅 TemporalParser detectou data: ${parsedDate.toISOString().split('T')[0]} (perfil: ${temporalInfo.profile}) para texto: "${text.substring(0, 50)}"`,
      );
    } catch (error) {
      // Fallback: se TemporalParser falhou, usar data atual
      this.logger.warn(`⚠️ TemporalParser falhou, usando data atual:`, error);
      date = today;
      temporalInfo = { profile: 'TODAY', confidence: 1.0 };
    }

    // 4. Extrair descrição (pegar apenas produto/mercadoria)
    // Criar regex dinâmico a partir das constantes
    const verbsRegex = new RegExp(`\\b(${[...TRANSACTION_VERBS].join('|')})\\b`, 'gi');
    const temporalRegex = new RegExp(`\\b(${[...TEMPORAL_WORDS].join('|')})\\b`, 'gi');
    const prepositionsRegex = new RegExp(`\\b(${[...PREPOSITIONS].join('|')})\\b`, 'gi');
    const articlesRegex = new RegExp(`\\b(${[...ARTICLES].join('|')})\\b`, 'gi');
    const adjectivesRegex = new RegExp(`\\b(${[...COMMON_ADJECTIVES].join('|')})\\b`, 'gi');
    const establishmentsRegex = new RegExp(`\\b(${[...COMMON_ESTABLISHMENTS].join('|')})\\b`, 'gi');

    let description = text
      .replace(/r\$\s*\d+[,.]?\d*/gi, '') // Remove valor
      .replace(/\bpor\s+\d+/gi, '') // Remove "por 1500"
      .replace(verbsRegex, '') // Remove verbos de transação
      .replace(temporalRegex, '') // Remove palavras temporais
      .replace(prepositionsRegex, '') // Remove preposições
      .replace(articlesRegex, '') // Remove artigos
      .replace(adjectivesRegex, '') // Remove adjetivos comuns
      .replace(establishmentsRegex, '') // Remove estabelecimentos
      .replace(/\s+/g, ' ') // Normaliza espaços
      .trim();

    // Se descrição ficou vazia ou muito curta (< 3 chars), não incluir
    if (!description || description.length < 3) {
      description = null;
    } else if (description.length > 100) {
      description = description.substring(0, 100);
    }

    return {
      type,
      amount,
      category: '', // Será preenchido pelo RAG
      subCategory: null,
      description, // null se redundante, string se tiver informação útil
      date,
      confidence: 0.85, // Confiança moderada (RAG + regex)
      merchant: null,
      temporalInfo, // Adicionar informações do temporal parser
    };
  }

  /**
   * 🆕 Detecta o tipo de transação (INCOME ou EXPENSES) baseado em palavras-chave
   */
  private async detectTransactionType(text: string): Promise<'INCOME' | 'EXPENSES' | undefined> {
    const normalizedText = text.toLowerCase();

    // Verificar EXPENSES primeiro (mais comum)
    for (const keyword of EXPENSE_KEYWORDS) {
      if (normalizedText.includes(keyword)) {
        this.logger.debug(`🔍 Tipo detectado: EXPENSES (palavra-chave: "${keyword}")`);
        return 'EXPENSES';
      }
    }

    // Verificar INCOME
    for (const keyword of INCOME_KEYWORDS) {
      if (normalizedText.includes(keyword)) {
        this.logger.debug(`🔍 Tipo detectado: INCOME (palavra-chave: "${keyword}")`);
        return 'INCOME';
      }
    }

    // Se não detectou, retorna undefined (não filtra)
    this.logger.debug(`🔍 Tipo NÃO detectado - sem filtro de tipo`);
    return undefined;
  }

  /**
   * Valida uso de cartão de crédito e aplica regras:
   * 1. Se tem cartão default → usar
   * 2. Se não tem default mas tem 1 cartão → definir como default e usar
   * 3. Se não tem cartão → retornar erro
   * 4. Se tem 2+ cartões → pedir escolha
   */
  private async validateCreditCardUsage(
    user: UserCache,
    accountId: string,
  ): Promise<{
    success: boolean;
    message: string;
    creditCardId?: string;
    wasAutoSet?: boolean;
  }> {
    try {
      this.logger.log(
        `💳 [VALIDATE CARD] Validando uso de cartão para usuário ${user.gastoCertoId}`,
      );

      // 1. Verificar se já tem cartão default
      if (user.defaultCreditCardId) {
        this.logger.log(
          `💳 [VALIDATE CARD] Cartão default encontrado: ${user.defaultCreditCardId}`,
        );
        return {
          success: true,
          message: '',
          creditCardId: user.defaultCreditCardId,
          wasAutoSet: false,
        };
      }

      // 2. Buscar cartões disponíveis (usando accountId específico)
      this.logger.log(`💳 [VALIDATE CARD] Buscando cartões do accountId: ${accountId}`);

      const cardsResult = await this.gastoCertoApi.listCreditCards(accountId);
      this.logger.log(`💳 [VALIDATE CARD] Cartões encontrados: ${JSON.stringify(cardsResult)}`);

      if (!cardsResult.success || !cardsResult.data || cardsResult.data.length === 0) {
        // 3. Não tem cartão cadastrado
        this.logger.warn(`💳 [VALIDATE CARD] Nenhum cartão cadastrado`);
        return {
          success: false,
          message:
            '💳 *Cartão de crédito não encontrado*\n\n' +
            '📭 Você ainda não tem cartões cadastrados.\n\n' +
            '💡 _Cadastre um cartão no app para usar esta funcionalidade!_',
        };
      }

      const cards = cardsResult.data;

      if (cards.length === 1) {
        // 4. Tem apenas 1 cartão → definir como default automaticamente
        const card = cards[0];
        this.logger.log(
          `💳 [VALIDATE CARD] Apenas 1 cartão encontrado - definindo como default: ${card.id}`,
        );

        // Definir como default no cache
        await this.userCache.setDefaultCreditCard(user.phoneNumber, card.id);

        return {
          success: true,
          message: '',
          creditCardId: card.id,
          wasAutoSet: true,
        };
      }

      // 5. Tem 2+ cartões → pedir escolha
      this.logger.warn(`💳 [VALIDATE CARD] Múltiplos cartões (${cards.length}) - requer escolha`);

      let message = '💳 *Escolha um cartão padrão*\n\n';
      message += `📊 Você tem ${cards.length} cartões cadastrados:\n\n`;
      message += '───────────────────\n\n';

      cards.forEach((card, index) => {
        message += `${index + 1}. 💳 *${card.name}*\n`;
        message += `   🏦 ${card.bank?.name || ''}\n`;
        message += `   💰 Limite: R$ ${(card.limit / 100).toFixed(2)}\n\n`;
      });

      message += '\n💡 _Digite: "usar cartão [nome]" para definir o padrão_';
      message += '\n\n📌 _Exemplo: "usar cartão nubank"_';

      return {
        success: false,
        message,
      };
    } catch (error) {
      this.logger.error(`❌ [VALIDATE CARD] Erro ao validar cartão:`, error);
      return {
        success: false,
        message: '❌ Erro ao validar cartão de crédito. Tente novamente.',
      };
    }
  }

  /**
   * Formata o perfil temporal para exibição amigável
   */
  private formatTemporalProfile(profile: string): string {
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
}

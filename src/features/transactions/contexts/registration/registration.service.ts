import { Injectable, Logger, Optional, forwardRef, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@core/database/prisma.service';
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
import { TemporalParserService } from '@common/services/temporal-parser.service';
import { MessageLearningService } from '../../message-learning.service';

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

      const activeAccountId = accountValidation.accountId;
      this.logger.debug(`🏦 Conta ativa: ${activeAccountId}`);

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

            ragMatches = await this.ragService.findSimilarCategories(text, user.gastoCertoId, {
              minScore: 0.4,
              maxResults: 3,
              transactionType: detectedType, // 🔥 Filtrar por tipo!
            });
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
        const startTime = Date.now();
        extractedData = await this.aiFactory.extractTransaction(text, userContext);
        responseTime = Date.now() - startTime;

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
        user.activeAccountId,
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

      if (this.messageLearningService) {
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
      } else {
        this.logger.warn(`⚠️ MessageLearningService não está disponível!`);
      }

      // 5. Sempre criar confirmação (a lógica de auto-register está no createConfirmation)
      return await this.createConfirmation(phoneNumber, extractedData, messageId, user, platform);
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
      return await this.createConfirmation(phoneNumber, extractedData, messageId, user, platform);
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

      // Buscar conta ativa se user disponível
      let accountId: string | undefined;
      if (user) {
        try {
          const activeAccount = await this.userCache.getActiveAccount(phoneNumber);
          accountId = activeAccount?.id;

          // 🔍 LOG DE DEBUG: Rastrear conta ativa sendo usada
          this.logger.log(
            `👤 [PERFIL DEBUG] Conta ativa para transação: ` +
              `phoneNumber=${phoneNumber}, ` +
              `accountId=${accountId || 'NENHUMA'}, ` +
              `accountName=${activeAccount?.name || 'N/A'}, ` +
              `userId=${user.gastoCertoId}`,
          );
        } catch (error) {
          this.logger.warn(`Não foi possível buscar conta ativa: ${error.message}`);
        }
      }

      // Resolver IDs de categoria e subcategoria ANTES de criar confirmação
      let categoryId: string | undefined;
      let subCategoryId: string | undefined;

      if (user && accountId) {
        try {
          this.logger.debug(
            `📊 [DEBUG] Dados extraídos ANTES de resolver IDs: category="${data.category}", subCategory="${data.subCategory}"`,
          );

          const resolved = await this.resolveCategoryAndSubcategory(
            user.gastoCertoId,
            accountId,
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
              accountId,
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
                const activeAcc = accounts.find((acc) => acc.id === accountId);
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
        accountId, // Incluir accountId da conta ativa
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
      if (user.accounts && Array.isArray(user.accounts)) {
        const accounts = user.accounts as Array<{
          id: string;
          name: string;
          type?: string;
          isPrimary?: boolean;
        }>;
        const activeAccount = accounts.find((acc) => acc.id === user.activeAccountId);
        if (activeAccount) {
          accountName = activeAccount.name;
        }
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
          `👤 *Perfil:* ${accountName}\n\n` +
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
          null,
        date: confirmation.date
          ? DateUtil.formatToISO(DateUtil.normalizeDate(confirmation.date))
          : DateUtil.formatToISO(DateUtil.today()),
        merchant: confirmation.extractedData?.merchant || data?.merchant,
        source: 'whatsapp',
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

    // 4. Extrair descrição (remover valor e palavras-chave)
    let description = text
      .replace(/r\$\s*\d+[,.]?\d*/gi, '') // Remove valor
      .replace(/gastei|comprei|paguei|recebi|ganhei/gi, '') // Remove verbos
      .replace(/no|na|em|de|do|da/gi, '') // Remove preposições
      .replace(/supermercado|mercado|farmácia|restaurante|padaria|lanchonete/gi, '') // Remove nomes comuns de estabelecimentos
      .replace(/\s+/g, ' ') // Normaliza espaços
      .trim();

    // Se descrição ficou vazia ou muito curta (< 5 chars), não incluir
    if (!description || description.length < 5) {
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

    // Palavras-chave de GASTO (EXPENSES)
    const expenseKeywords = [
      'gastei',
      'paguei',
      'comprei',
      'gasto',
      'pago',
      'compra',
      'despesa',
      'débito',
      'debito',
      'saiu',
      'saque',
    ];

    // Palavras-chave de RECEITA (INCOME)
    const incomeKeywords = [
      'recebi',
      'recebido',
      'receita',
      'salário',
      'salario',
      'rendimento',
      'pagamento',
      'entrou',
      'depósito',
      'deposito',
      'ganho',
      'entrada',
    ];

    // Verificar EXPENSES primeiro (mais comum)
    for (const keyword of expenseKeywords) {
      if (normalizedText.includes(keyword)) {
        this.logger.debug(`🔍 Tipo detectado: EXPENSES (palavra-chave: "${keyword}")`);
        return 'EXPENSES';
      }
    }

    // Verificar INCOME
    for (const keyword of incomeKeywords) {
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

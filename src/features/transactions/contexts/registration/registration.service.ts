import { Injectable, Logger, Optional, forwardRef, Inject, OnModuleInit } from '@nestjs/common';
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
import { CreateTransactionConfirmationDto } from '../../dto/transaction.dto';
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
import {
  PDF_EXTRACTION_SYSTEM_PROMPT,
  PDF_EXTRACTION_USER_PROMPT,
} from './prompts/pdf-analysis.prompt';
import { findMerchant } from '@common/constants/merchants';
import { InstallmentParserService } from '@features/transactions/services/parsers/installment-parser.service';
import { FixedTransactionParserService } from '@features/transactions/services/parsers/fixed-transaction-parser.service';
import { CreditCardParserService } from '@features/transactions/services/parsers/credit-card-parser.service';
import { CreditCardInvoiceCalculatorService } from '@features/transactions/services/parsers/credit-card-invoice-calculator.service';
import { PaymentStatusResolverService } from '../../services/payment-status-resolver.service';
import { CategoryResolverService } from '../../services/category-resolver.service';
import { TransactionApiSenderService } from './transaction-api-sender.service';
import { TransactionMessageFormatterService } from './transaction-message-formatter.service';

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
export class TransactionRegistrationService implements OnModuleInit {
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
    private readonly prisma: PrismaService,
    private readonly temporalParser: TemporalParserService,
    private readonly installmentParser: InstallmentParserService,
    private readonly fixedParser: FixedTransactionParserService,
    private readonly creditCardParser: CreditCardParserService,
    private readonly invoiceCalculator: CreditCardInvoiceCalculatorService,
    private readonly paymentStatusResolver: PaymentStatusResolverService,
    private readonly categoryResolver: CategoryResolverService,
    private readonly apiSender: TransactionApiSenderService,
    private readonly messageFormatter: TransactionMessageFormatterService,
    @Optional()
    @Inject(forwardRef(() => MessageLearningService))
    private readonly messageLearningService?: MessageLearningService,
    @Optional() private readonly ragService?: RAGService,
  ) {
    // Valores temporários até carregar do banco via onModuleInit
    this.autoRegisterThreshold = 0.9;
    this.minConfidenceThreshold = 0.5;

    // ✅ LOG DE DEBUG DE INJEÇÃO
    this.logger.log(
      `🎓 [TransactionRegistrationService] Inicializado com: ` +
        `messageLearningService=${!!messageLearningService}, ` +
        `ragService=${!!ragService}`,
    );
  }

  /**
   * Lifecycle hook — garante que as configurações sejam carregadas
   * ANTES do serviço receber qualquer requisição
   */
  async onModuleInit(): Promise<void> {
    await this.loadSettings();
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
        await this.indexCategoriesInRAG(
          user.gastoCertoId,
          categoriesData.categories,
          activeAccountId,
        );
      }

      // 2. FASE 1: Tentar RAG match direto (rápido, sem custo)
      let extractedData: any = null;
      let responseTime = 0;
      let usedAI = false;

      this.logger.log(
        `🚀 INICIANDO PROCESSAMENTO | Platform: ${platform} | Phone: ${phoneNumber} | Message: "${text.substring(0, 50)}..."`,
      );

      // Detectar tipo de transação UMA VEZ e reutilizar em todas as fases RAG
      const detectedType = ragEnabled ? await this.detectTransactionType(text) : null;

      // 🆕 [QW3] FASE 0: Tentar match por merchant conhecido (zero custo, zero IA)
      // Catálogo de ~100 merchants brasileiros (iFood, Uber, Netflix, supermercados, etc.)
      const merchantMatch = findMerchant(text);
      if (merchantMatch) {
        this.logger.log(
          `🏪 [Merchant] Match: "${merchantMatch.matchedKeyword}" → ${merchantMatch.entry.category}` +
            `${merchantMatch.entry.subCategory ? ` > ${merchantMatch.entry.subCategory}` : ''} (score: ${merchantMatch.score.toFixed(2)})`,
        );
        const merchantData: any = this.extractBasicData(text);
        merchantData.category = merchantMatch.entry.category;
        merchantData.subCategory = merchantMatch.entry.subCategory || null;
        // Só substituir o tipo detectado se o merchant tiver tipo explícito
        merchantData.type = merchantMatch.entry.type;
        merchantData.confidence = Math.max(merchantData.confidence ?? 0, merchantMatch.score);
        merchantData.source = 'MERCHANT_DB';
        // Só aceitar direto se temos valor extraído com sucesso
        if (merchantData.amount && merchantData.amount > 0) {
          extractedData = merchantData;
        }
      }

      if (ragEnabled && !extractedData) {
        extractedData = await this.matchWithRAG(
          text,
          user.gastoCertoId,
          activeAccountId,
          aiSettings,
          detectedType,
        );
      }

      // 3. FASE 2+3: Se RAG não funcionou, usar IA + revalidação
      if (!extractedData) {
        const aiResult = await this.extractWithAIAndRevalidate(
          text,
          userContext,
          user.gastoCertoId,
          aiSettings,
          ragEnabled,
          detectedType,
          activeAccountId,
        );
        extractedData = aiResult.extractedData;
        responseTime = aiResult.responseTime;
        usedAI = true;
      }

      // Log de extração
      this.logger.log(
        `✅ Transação extraída (${extractedData.source || 'unknown'}) | ` +
          `Tipo: ${extractedData.type} | ` +
          `Valor: R$ ${extractedData.amount} | ` +
          `Categoria: ${extractedData.category}${extractedData.subCategory ? ` > ${extractedData.subCategory}` : ' (sem subcategoria)'} | ` +
          `Confiança: ${(extractedData.confidence * 100).toFixed(1)}%`,
      );

      // 4. Enriquecer com detecções avançadas (parcelamento, fixa, cartão, fatura, status)
      const detectorEarlyExit = await this.enrichWithDetectors(
        text,
        extractedData,
        user,
        activeAccountId,
      );
      if (detectorEarlyExit) return detectorEarlyExit;

      // Registrar uso de IA apenas se foi usada
      if (usedAI) {
        await this.logAIUsage({
          phoneNumber,
          gastoCertoId: user.gastoCertoId,
          platform,
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
      const resolved = await this.categoryResolver.resolve(
        user.gastoCertoId,
        activeAccountId,
        extractedData.category,
        extractedData.subCategory,
        extractedData.type,
      );

      // Enriquecer extractedData com IDs resolvidos
      extractedData.categoryId = resolved.categoryId;
      extractedData.subCategoryId = resolved.subCategoryId;

      // Se a categoria sugerida pela IA não existe na conta do usuário,
      // limpar para "Outros" para que o fluxo de aprendizado seja acionado
      if (resolved.categoryId === null && extractedData.category && extractedData.category !== 'Outros') {
        this.logger.warn(
          `⚠️ Categoria "${extractedData.category}" não existe na conta ${activeAccountId} — forçando "Outros" para acionar fluxo de aprendizado`,
        );
        extractedData.category = 'Outros';
        extractedData.subCategory = null;
      }

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

        // Se createConfirmation já fez AUTO-REGISTER (enviou para API), retornar direto
        if (!confirmResult.requiresConfirmation) {
          this.logger.log(
            `✅ Confirmação ${confirmResult.confirmationId} já processada pelo auto-register (skipLearning)`,
          );
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

      // 🆕 [QW3+QW5+QW6] Refinar categorização da imagem usando merchant DB + RAG
      await this.refineCategoryWithMerchantOrRAG(
        extractedData,
        user.gastoCertoId,
        activeAccountId,
        'Image',
      );

      // Registrar uso de IA
      await this.logAIUsage({
        phoneNumber,
        gastoCertoId: user.gastoCertoId,
        platform,
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
        gastoCertoId: user.gastoCertoId,
        platform,
        operation: 'AUDIO_TRANSCRIPTION',
        inputType: 'AUDIO',
        inputText: `Audio: ${mimeType} (${audioBuffer.length} bytes)`,
        responseTimeMs: responseTime,
        mimeType,
        imageSize: audioBuffer.length,
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
   * Processa documento PDF e extrai transação(ões)
   * Usa pdf-parse para extrair texto e depois processa como texto estruturado via IA
   */
  async processDocumentTransaction(
    phoneNumber: string,
    documentBuffer: Buffer,
    mimeType: string,
    fileName: string,
    messageId: string,
    user: UserCache,
    platform: string = 'whatsapp',
    accountId?: string,
  ): Promise<{
    success: boolean;
    message: string;
    requiresConfirmation: boolean;
    confirmationId?: string;
    transactionCount?: number;
  }> {
    try {
      this.logger.log(`📄 [Registration] Processando documento "${fileName}" de ${phoneNumber}`);

      if (!accountId) {
        this.logger.error(`❌ AccountId não fornecido para ${phoneNumber}`);
        return {
          success: false,
          message: '❌ Erro interno: conta não identificada.',
          requiresConfirmation: false,
        };
      }

      const isPdf = mimeType === 'application/pdf' || fileName?.toLowerCase().endsWith('.pdf');

      if (!isPdf) {
        this.logger.warn(`⚠️ Tipo de documento não suportado: ${mimeType}`);
        return {
          success: false,
          message:
            '❌ Formato de documento não suportado.\n\n' +
            '📄 Suporto apenas arquivos *PDF*.\n\n' +
            '_Envie um PDF de nota fiscal, extrato ou comprovante._',
          requiresConfirmation: false,
        };
      }

      // 1. Extrair texto do PDF usando pdf-parse
      let pdfText: string;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const pdfParse = require('pdf-parse');
        const pdfData = await pdfParse(documentBuffer);
        pdfText = pdfData.text?.trim();
        this.logger.log(
          `📝 Texto extraído do PDF: ${pdfText?.length || 0} chars | ${pdfData.numpages} página(s)`,
        );
      } catch (parseError) {
        this.logger.error(`❌ Erro ao extrair texto do PDF: ${parseError.message}`);
        return {
          success: false,
          message:
            '❌ Não consegui ler o PDF enviado.\n\n' +
            '_Verifique se o arquivo não está corrompido ou protegido por senha._',
          requiresConfirmation: false,
        };
      }

      if (!pdfText || pdfText.length < 10) {
        this.logger.warn(`⚠️ PDF sem texto legível (possivelmente escaneado como imagem)`);
        return {
          success: false,
          message:
            '⚠️ Não encontrei texto no PDF.\n\n' +
            '_PDFs escaneados como imagem ainda não são suportados._\n\n' +
            '💡 *Dica:* Tire uma *foto* do documento para eu conseguir analisar!',
          requiresConfirmation: false,
        };
      }

      // 2. Usar IA para extrair transação(ões) do texto do PDF
      const startTime = Date.now();
      const aiProvider = this.aiFactory;
      let parsedResult: any;

      try {
        const prompt = PDF_EXTRACTION_USER_PROMPT(pdfText);
        const rawExtraction = await aiProvider.extractTransaction(
          `${PDF_EXTRACTION_SYSTEM_PROMPT}\n\n${prompt}`,
          {
            name: user.name,
            email: user.email,
            categories: [],
          },
        );

        // A IA retorna JSON estruturado — tentar parsear do rawData ou do description
        if (rawExtraction.rawData) {
          parsedResult = rawExtraction.rawData;
        } else {
          // Fallback: usar os campos diretos como transação única
          parsedResult = {
            documentType: 'documento',
            transactions: [rawExtraction],
          };
        }
      } catch (aiError) {
        this.logger.error(`❌ Erro na IA ao processar PDF: ${aiError.message}`);
        return {
          success: false,
          message: '❌ Erro ao analisar o documento.\n\n_Tente novamente em alguns instantes._',
          requiresConfirmation: false,
        };
      }

      const responseTime = Date.now() - startTime;

      await this.logAIUsage({
        phoneNumber,
        gastoCertoId: user.gastoCertoId,
        platform,
        operation: 'DOCUMENT_EXTRACTION',
        inputType: 'TEXT',
        inputText: `PDF: ${fileName} (${pdfText.length} chars)`,
        responseTimeMs: responseTime,
        imageSize: documentBuffer.length,
        mimeType,
      });

      // 3. Processar transações extraídas
      const transactions: any[] = parsedResult?.transactions || [];

      if (transactions.length === 0) {
        return {
          success: false,
          message:
            '❓ Não identifiquei transações financeiras neste PDF.\n\n' +
            '_Envie notas fiscais, extratos, comprovantes ou boletos quitados._',
          requiresConfirmation: false,
        };
      }

      // Para um único item (mais comum): processar normalmente
      if (transactions.length === 1) {
        const extractedData = transactions[0] as any;
        extractedData.confidence = extractedData.confidence ?? 0.8;

        // 🆕 [M3] Refinar categorização do PDF com merchant DB + RAG (mesmo padrão de imagem)
        await this.refineCategoryWithMerchantOrRAG(
          extractedData,
          user.gastoCertoId,
          accountId,
          'PDF',
        );

        this.logger.log(
          `✅ Transação extraída do PDF | Tipo: ${extractedData.type} | Valor: R$ ${extractedData.amount} | Confiança: ${(extractedData.confidence * 100).toFixed(1)}%`,
        );

        // Validar e confirmar
        return await this.createConfirmation(
          phoneNumber,
          extractedData,
          messageId,
          user,
          platform,
          accountId,
        );
      }

      // Para múltiplas transações (extrato): processar o primeiro e informar o usuário
      const firstTx = transactions[0];
      const docType = parsedResult?.documentType || 'documento';
      const summary = parsedResult?.summary || '';

      this.logger.log(
        `📊 PDF com ${transactions.length} transações detectadas (${docType}). Processando primeira.`,
      );

      const multipleMessage =
        `📄 *${docType.charAt(0).toUpperCase() + docType.slice(1)} identificado*\n\n` +
        (summary ? `📋 ${summary}\n\n` : '') +
        `🔢 *${transactions.length} transações encontradas.*\n\n` +
        `⚠️ _No momento processo uma transação por vez._\n` +
        `_Para registrar todas, envie o arquivo separado por partes ou informe manualmente._\n\n` +
        `*Primeira transação encontrada:*\n` +
        `💰 R$ ${firstTx.amount?.toFixed(2)} — ${firstTx.description || firstTx.category}`;

      // Criar confirmação para primeira transação
      firstTx.confidence = firstTx.confidence ?? 0.75;

      // 🆕 [M3] Refinar categorização com merchant DB + RAG
      await this.refineCategoryWithMerchantOrRAG(firstTx, user.gastoCertoId, accountId, 'PDF');

      const firstResult = await this.createConfirmation(
        phoneNumber,
        firstTx,
        messageId,
        user,
        platform,
        accountId,
      );

      return {
        ...firstResult,
        message: multipleMessage + '\n\n' + firstResult.message,
        transactionCount: transactions.length,
      };
    } catch (error) {
      this.logger.error(`❌ Erro ao processar documento:`, error);
      throw error;
    }
  }

  /**
   * Registra transação automaticamente (alta confiança)
   * SEMPRE cria registro no banco (transactionConfirmations) para rastreabilidade
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

      // ✅ SEMPRE criar registro no banco primeiro
      const confirmation = await this.createConfirmation(
        phoneNumber,
        data,
        messageId,
        user,
        platform,
        accountId,
      );

      if (!confirmation.confirmationId) {
        throw new Error('Falha ao criar registro de confirmação');
      }

      // Auto-confirmar (PENDING → CONFIRMED)
      const confirmed = await this.confirmationService.confirm(confirmation.confirmationId);
      this.logger.log(`✅ Confirmação ${confirmed.id} auto-confirmada (autoRegisterTransaction)`);

      // Enviar para API
      const result = await this.apiSender.sendTransactionToApi(confirmed, data);

      if (result.success) {
        // Marcar como enviado para API
        await this.prisma.transactionConfirmation.update({
          where: { id: confirmed.id },
          data: { apiSent: true, apiSentAt: new Date() },
        });

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
        // Marcar erro no registro
        await this.prisma.transactionConfirmation.update({
          where: { id: confirmed.id },
          data: {
            apiError: result.error || 'Erro ao enviar para API',
            apiRetryCount: { increment: 1 },
          },
        });
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
        this.logger.error(`❌ AccountId não fornecido em createConfirmation para ${phoneNumber}`);
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

          const resolved = await this.categoryResolver.resolve(
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
          // Registrar automaticamente sem pedir confirmação, MAS sempre gravar no banco
          if (categoryId && subCategoryId && data.confidence >= this.autoRegisterThreshold) {
            this.logger.log(
              `⚡ AUTO-REGISTER ativado: categoryId + subCategoryId resolvidos + confiança ${(data.confidence * 100).toFixed(1)}% >= ${(this.autoRegisterThreshold * 100).toFixed(0)}%`,
            );

            // ✅ SEMPRE criar registro no banco antes de enviar para API
            const amountInCentsAuto = Math.round(data.amount * 100);
            const autoDto: CreateTransactionConfirmationDto = {
              phoneNumber,
              platform,
              userId: user?.id,
              accountId: finalAccountId,
              messageId,
              type: data.type as any,
              amount: amountInCentsAuto,
              category: data.category,
              categoryId,
              subCategoryId,
              subCategoryName: data.subCategory || null,
              description: data.description,
              date: validDate,
              extractedData: {
                merchant: data.merchant,
                confidence: data.confidence,
                subcategory: data.subCategory,
              },
              isFixed: data.isFixed || undefined,
              fixedFrequency: data.fixedFrequency || undefined,
              installments: data.installments || undefined,
              installmentNumber: data.installmentNumber || undefined,
              creditCardId: data.creditCardId || undefined,
              paymentStatus: data.paymentStatus || undefined,
              invoiceMonth: data.invoiceMonth || undefined,
            };

            const autoConfirmation = await this.confirmationService.create(autoDto);
            this.logger.log(`📋 Registro criado no banco: ${autoConfirmation.id} (auto-register)`);

            // Auto-confirmar imediatamente (PENDING → CONFIRMED)
            const confirmed = await this.confirmationService.confirm(autoConfirmation.id);
            this.logger.log(`✅ Confirmação ${confirmed.id} auto-confirmada`);

            // Enviar para API
            const result = await this.apiSender.sendTransactionToApi(confirmed, data);

            if (result.success) {
              // Marcar como enviado para API
              await this.prisma.transactionConfirmation.update({
                where: { id: confirmed.id },
                data: { apiSent: true, apiSentAt: new Date() },
              });

              // 👤 Buscar nome da conta ativa
              const accountName = this.messageFormatter.findAccountName(
                user.accounts,
                finalAccountId,
              );

              const successMessage = this.messageFormatter.formatSuccessMessage({
                type: data.type,
                amount: data.amount,
                category: data.category,
                subCategory: data.subCategory,
                description: data.description,
                date: validDate,
                temporalProfile: data.temporalInfo?.profile || 'TODAY',
                accountName,
              });

              return {
                success: true,
                message: successMessage,
                requiresConfirmation: false,
                confirmationId: confirmed.id,
              };
            }
            // Se falhar na API, marcar erro mas manter registro
            await this.prisma.transactionConfirmation.update({
              where: { id: confirmed.id },
              data: {
                apiError: result.error || 'Erro ao enviar para API',
                apiRetryCount: { increment: 1 },
              },
            });
            this.logger.warn(
              `⚠️ Auto-register falhou na API, registro ${confirmed.id} mantido para retry: ${result.error}`,
            );

            // 👤 Buscar nome da conta ativa
            const accountNameRetry = this.messageFormatter.findAccountName(
              user.accounts,
              finalAccountId,
            );

            const retryMessage = this.messageFormatter.formatSuccessMessage({
              type: data.type,
              amount: data.amount,
              category: data.category,
              subCategory: data.subCategory,
              description: data.description,
              date: validDate,
              temporalProfile: data.temporalInfo?.profile || 'TODAY',
              accountName: accountNameRetry,
            });

            return {
              success: true,
              message:
                retryMessage +
                '\n\n⚠️ A transação foi registrada localmente e será sincronizada em breve.',
              requiresConfirmation: false,
              confirmationId: confirmed.id,
            };
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
          creditCardName: (data as any).creditCardName,
          installmentValueType: data.installmentValueType,
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

      // 👤 Buscar nome da conta ativa do usuário
      const accountName = this.messageFormatter.findAccountName(user?.accounts, accountId);

      // Formatar mensagem de confirmação via formatter
      const confirmationMessage = this.messageFormatter.formatConfirmationMessage({
        data,
        validDate,
        accountName,
      });

      return {
        success: true,
        message: confirmationMessage,
        requiresConfirmation: true,
        confirmationId: confirmation.id,
      };
    } catch (error) {
      this.logger.error(`❌ Erro ao criar confirmação:`, error);
      // 🛡️ Nunca deixar o usuário sem resposta
      return {
        success: false,
        message:
          'Desculpe, ocorreu um erro ao processar sua transação. Tente novamente em instantes.',
        requiresConfirmation: false,
        confirmationId: '',
      };
    }
  }

  // Recurring/installment logic delegated to RecurringTransactionService

  /**
   * Registra transação confirmada pelo usuário na API GastoCerto.
   * Delegado ao TransactionApiSenderService.
   */
  async registerConfirmedTransaction(
    confirmation: any,
  ): Promise<{ success: boolean; message: string }> {
    return this.apiSender.registerConfirmedTransaction(confirmation);
  }

  /**
   * Método específico para retry job — delegado ao TransactionApiSenderService.
   */
  async sendConfirmedTransactionToApi(confirmation: any): Promise<{
    success: boolean;
    error?: string;
    transactionId?: string;
  }> {
    return this.apiSender.sendConfirmedTransactionToApi(confirmation);
  }

  /**
   * Reenvia uma transação pendente — delegado ao TransactionApiSenderService.
   */
  async resendTransaction(
    confirmationId: string,
  ): Promise<{ success: boolean; error?: string; transactionId?: string }> {
    return this.apiSender.resendTransaction(confirmationId);
  }

  // ═══════════════════════════════════════════════════════════════
  // Private sub-methods extracted from processTextTransaction
  // ═══════════════════════════════════════════════════════════════

  /**
   * Indexa categorias do usuário no RAG para matching semântico.
   * Expande categorias com subcategorias em entradas individuais.
   */
  private async indexCategoriesInRAG(
    userId: string,
    categories: any[],
    accountId?: string | null,
  ): Promise<void> {
    try {
      // Expandir cada categoria com suas subcategorias (criar entrada para cada uma)
      const { expandCategoriesForRAG } = await import('../../../users/user-cache.service');
      const userCategories = expandCategoriesForRAG(categories);

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

      await this.ragService.indexUserCategories(userId, userCategories, accountId);
      this.logger.log(
        `🧠 RAG indexado: ${userCategories.length} categorias | ` +
          `UserId: ${userId} | AccountId: ${accountId || 'default'}`,
      );
    } catch (ragError) {
      this.logger.warn(`⚠️ Erro ao indexar RAG (não bloqueante):`, ragError);
    }
  }

  /**
   * 🆕 [QW3+QW5+QW6+M3] Refina categoria/subcategoria de uma transação extraída por IA
   * (imagem ou PDF) usando merchant DB primeiro e RAG como fallback.
   *
   * Mutation in-place no `data`. Não bloqueante — qualquer erro é apenas logado.
   *
   * @param data Transação a refinar (mutável). Espera ao menos `description` ou `category`.
   * @param userId gastoCertoId do usuário
   * @param accountId conta ativa (para escopo do RAG)
   * @param sourceLabel rótulo para logs (ex: 'Image', 'PDF')
   */
  private async refineCategoryWithMerchantOrRAG(
    data: any,
    userId: string,
    accountId: string | null | undefined,
    sourceLabel: string,
  ): Promise<void> {
    const lowConfidence = (data.confidence ?? 0) < 0.7;
    const description = (data.description || data.category || '').trim();
    if (!description) return;

    // 1. Merchant DB (zero custo)
    const merchantHit = findMerchant(description);
    if (merchantHit && (lowConfidence || merchantHit.score > 0.7)) {
      this.logger.log(
        `🏪 [${sourceLabel}+Merchant] "${merchantHit.matchedKeyword}" → ${merchantHit.entry.category}` +
          `${merchantHit.entry.subCategory ? ` > ${merchantHit.entry.subCategory}` : ''}`,
      );
      data.category = merchantHit.entry.category;
      data.subCategory = merchantHit.entry.subCategory || data.subCategory;
      data.confidence = Math.max(data.confidence ?? 0, merchantHit.score);
      return;
    }

    // 2. Fallback para RAG quando confiança baixa
    if (!lowConfidence || !this.ragService) return;
    try {
      const aiSettings = await this.aiConfigService.getSettings();
      if (!aiSettings.ragEnabled) return;

      const ragMatches = await this.ragService.findSimilarCategories(description, userId, {
        accountId,
        minScore: 0.5,
        maxResults: 1,
        transactionType: data.type as any,
      });
      if (ragMatches[0] && ragMatches[0].score >= 0.6) {
        this.logger.log(
          `🔍 [${sourceLabel}+RAG] Match: ${ragMatches[0].categoryName}` +
            `${ragMatches[0].subCategoryName ? ` > ${ragMatches[0].subCategoryName}` : ''} ` +
            `(score: ${(ragMatches[0].score * 100).toFixed(1)}%)`,
        );
        data.category = ragMatches[0].categoryName;
        data.subCategory = ragMatches[0].subCategoryName || data.subCategory;
        data.confidence = Math.max(data.confidence ?? 0, ragMatches[0].score);
      }
    } catch (ragErr) {
      this.logger.warn(`[${sourceLabel}+RAG] não bloqueante:`, ragErr);
    }
  }

  /**
   * FASE 1: Tentativa de match direto via RAG (BM25 ou embeddings).
   * Retorna dados da transação se encontrou match com score >= threshold, null caso contrário.
   */
  private async matchWithRAG(
    text: string,
    userId: string,
    accountId: string | null | undefined,
    aiSettings: any,
    detectedType: 'INCOME' | 'EXPENSES' | undefined | null,
  ): Promise<any | null> {
    try {
      const ragThreshold = aiSettings.ragThreshold || 0.6;
      this.logger.log(`🔍 FASE 1: Tentando RAG primeiro...`);

      let ragMatches: any[] = [];

      // Decidir: BM25 ou Embeddings de IA
      if (aiSettings.ragAiEnabled) {
        // NOVO: Busca vetorial com embeddings de IA
        this.logger.log(`🤖 Usando busca vetorial com IA (${aiSettings.ragAiProvider})...`);

        // Obter AI provider configurado para RAG
        const ragProvider = await this.aiFactory.getProvider(aiSettings.ragAiProvider || 'openai');

        ragMatches = await this.ragService.findSimilarCategoriesWithEmbeddings(
          text,
          userId,
          ragProvider,
          { accountId, minScore: 0.4, maxResults: 3, transactionType: detectedType },
        );
      } else {
        // Original: Busca BM25 (sem IA)
        this.logger.log(`📊 Usando busca BM25 (sem IA)...`);

        this.logger.log(
          `📊 [DEBUG] Chamando ragService.findSimilarCategories com userId=${userId}, text="${text}", type=${detectedType}`,
        );

        ragMatches = await this.ragService.findSimilarCategories(text, userId, {
          minScore: 0.4,
          maxResults: 3,
          transactionType: detectedType,
          accountId,
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
        const extractedData: any = this.extractBasicData(text);
        extractedData.category = bestMatch.categoryName;
        extractedData.subCategory = bestMatch.subCategoryName || null;
        extractedData.confidence = bestMatch.score;
        extractedData.source = aiSettings.ragAiEnabled ? 'RAG_AI_DIRECT' : 'RAG_DIRECT';
        return extractedData;
      }

      this.logger.log(
        `⚠️ RAG score baixo (${ragMatches[0]?.score ? (ragMatches[0].score * 100).toFixed(1) : 0}% < ${ragThreshold * 100}%) - Usando IA...`,
      );
      return null;
    } catch (ragError) {
      this.logger.warn(`⚠️ Erro no RAG fase 1 (não bloqueante):`, ragError);
      return null;
    }
  }

  /**
   * FASE 2+3: Extrai dados da transação via IA e revalida com RAG.
   * Chamado quando RAG Phase 1 não encontrou match direto.
   */
  private async extractWithAIAndRevalidate(
    text: string,
    userContext: any,
    userId: string,
    aiSettings: any,
    ragEnabled: any,
    detectedType: 'INCOME' | 'EXPENSES' | undefined | null,
    accountId?: string | null,
  ): Promise<{ extractedData: any; responseTime: number }> {
    this.logger.log(`🤖 FASE 2: Chamando IA para extrair transação...`);
    this.logger.debug(
      `📝 UserContext enviado para IA: ` +
        `name=${userContext.name}, ` +
        `categories=${userContext.categories.length}`,
    );
    const startTime = Date.now();
    const extractedData: any = await this.aiFactory.extractTransaction(text, userContext);
    const responseTime = Date.now() - startTime;
    this.logger.log(
      `✅ IA retornou: ${extractedData.type} | ${extractedData.category}${extractedData.subCategory ? ` > ${extractedData.subCategory}` : ''} | Confidence: ${(extractedData.confidence * 100).toFixed(1)}%`,
    );

    // FASE 3: Revalidar categoria da IA com RAG
    if (ragEnabled && extractedData.category) {
      try {
        const ragThreshold = aiSettings.ragThreshold || 0.6;
        this.logger.log(`🔍 FASE 3: Revalidando categoria da IA com RAG...`);

        const ragMatches = await this.ragService.findSimilarCategories(text, userId, {
          minScore: 0.5,
          maxResults: 1,
          transactionType: detectedType,
          accountId,
        });

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
          extractedData.subCategory = bestMatch.subCategoryName;
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

    return { extractedData, responseTime };
  }

  /**
   * Enriquece dados extraídos com detecções avançadas:
   * parcelamento, transação fixa, cartão de crédito, fatura e status de pagamento.
   * Retorna early-exit response se validação de cartão falhar, null caso contrário.
   */
  private async enrichWithDetectors(
    text: string,
    extractedData: any,
    user: UserCache,
    activeAccountId: string,
  ): Promise<{ success: false; message: string; requiresConfirmation: false } | null> {
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
      extractedData.installmentValueType = installmentDetection.installmentValueType;
      this.logger.log(
        `💳 Parcelamento detectado: ${installmentDetection.installments}x` +
          ` | tipo: ${installmentDetection.installmentValueType}` +
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
      if (cardValidation.cardName) extractedData.creditCardName = cardValidation.cardName;
      this.logger.log(
        `💳 Cartão de crédito validado` +
          ` (keywords: ${creditCardDetection.matchedKeywords?.join(', ')})` +
          ` | creditCardId: ${cardValidation.creditCardId}` +
          ` | cardName: ${cardValidation.cardName || 'desconhecido'}` +
          ` | ${cardValidation.wasAutoSet ? 'AUTO-SET' : 'DEFAULT'}`,
      );
    }

    // 5. Calcular mês da fatura (se for cartão de crédito)
    let invoiceMonth: string | undefined;
    let invoiceMonthFormatted: string | undefined;

    if (extractedData.creditCardId) {
      try {
        const closingDay = await this.invoiceCalculator.getCardClosingDay(
          activeAccountId,
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
      extractedData.confidence = Math.min(extractedData.confidence, 0.75);
      this.logger.log(
        `⚠️ Confirmação obrigatória: confidence ajustada de ${((extractedData.confidence || 0) * 100).toFixed(1)}% para máx 75%`,
      );
    }

    return null; // Sem early-exit — continuar processamento normal
  }

  /**
   * Log consolidado de uso de IA
   */
  private async logAIUsage(params: {
    phoneNumber: string;
    gastoCertoId: string;
    platform: string;
    operation:
      | 'TRANSACTION_EXTRACTION'
      | 'IMAGE_ANALYSIS'
      | 'AUDIO_TRANSCRIPTION'
      | 'DOCUMENT_EXTRACTION';
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
        gastoCertoId: params.gastoCertoId,
        platform: params.platform,
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
        message: this.messageFormatter.formatValidationError(validation.errors),
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
      .replace(/r\$\s*\d+[,.]?\d*/gi, '') // Remove valor com R$
      .replace(/\b\d+[,.]\d{1,2}\b/g, '') // Remove valores decimais sem R$ (ex: "5,30", "123,45")
      .replace(/\b\d+\b/g, '') // Remove números inteiros soltos
      .replace(/\bpor\s+\d+/gi, '') // Remove "por 1500"
      .replace(/\b(reais|real|centavos?|brl)\b/gi, '') // Remove unidades monetárias
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
    cardName?: string;
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
        // Buscar nome do cartão para exibição (não bloqueia em caso de falha)
        let cardName: string | undefined;
        try {
          const nameResult = await this.gastoCertoApi.listCreditCards(accountId);
          const found = nameResult.data?.find((c: any) => c.id === user.defaultCreditCardId);
          cardName = found?.name;
        } catch {
          /* nome é opcional */
        }
        return {
          success: true,
          message: '',
          creditCardId: user.defaultCreditCardId,
          cardName,
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
}

import { Injectable, Logger } from '@nestjs/common';
import { TransactionsService } from '@features/transactions/transactions.service';
import { UserCacheService } from '@features/users/user-cache.service';
import { MessageLearningService } from '@features/transactions/message-learning.service';
import { GastoCertoApiService } from '@shared/gasto-certo-api.service';
import { RedisService } from '@common/services/redis.service';
import { WebChatResponse } from './webchat.controller';
import { UploadResponse } from './dto/upload.dto';
import type { Multer } from 'multer';
import {
  WEBCHAT_SHOW_PROFILE_COMMANDS,
  WEBCHAT_MANAGEMENT_COMMANDS,
} from '@common/constants/nlp-keywords.constants';

/**
 * WebChatService
 *
 * Serviço para processar mensagens do chat web do frontend.
 * Reutiliza toda a lógica de processamento de transações do WhatsApp/Telegram.
 *
 * Fluxo:
 * 1. Recebe mensagem do frontend (usuário já autenticado)
 * 2. Busca dados do usuário no cache/banco
 * 3. Processa usando TransactionsService (mesma lógica WhatsApp)
 * 4. Formata resposta estruturada para o frontend
 *
 * Performance:
 * - Cache Redis para getUserAccounts() (TTL: 5min)
 * - Reduz latência de ~100ms para ~10ms
 */
@Injectable()
export class WebChatService {
  private readonly logger = new Logger(WebChatService.name);
  private readonly ACCOUNTS_CACHE_TTL = 300; // 5 minutos
  private readonly ACCOUNTS_CACHE_PREFIX = 'webchat:accounts:';

  constructor(
    private readonly transactionsService: TransactionsService,
    private readonly userCacheService: UserCacheService,
    private readonly messageLearningService: MessageLearningService,
    private readonly gastoCertoApi: GastoCertoApiService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Remove emojis e ícones de uma mensagem
   * Preserva quebras de linha (\n) para exibição correta no chat
   */
  private removeEmojis(text: string): string {
    // Remove emojis unicode
    return text
      .replace(/[\u{1F600}-\u{1F64F}]/gu, '') // Emoticons
      .replace(/[\u{1F300}-\u{1F5FF}]/gu, '') // Símbolos e pictogramas
      .replace(/[\u{1F680}-\u{1F6FF}]/gu, '') // Transporte e símbolos de mapa
      .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '') // Bandeiras
      .replace(/[\u{2600}-\u{26FF}]/gu, '') // Símbolos diversos
      .replace(/[\u{2700}-\u{27BF}]/gu, '') // Dingbats
      .replace(/[\u{1F900}-\u{1F9FF}]/gu, '') // Símbolos e pictogramas suplementares
      .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '') // Símbolos estendidos-A
      .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '') // Símbolos estendidos-B
      .replace(/[\u{FE00}-\u{FE0F}]/gu, '') // Seletores de variação
      .replace(/[\u{200D}]/gu, '') // Zero width joiner
      .replace(/[ \t]+/g, ' ') // Normalizar espaços horizontais (preserva \n)
      .replace(/\n{3,}/g, '\n\n') // Limitar múltiplas quebras de linha a no máximo 2
      .trim();
  }

  /**
   * Processa mensagem do chat web
   * @param userId - ID do usuário no GastoCerto (extraído do JWT)
   * @param messageText - Mensagem enviada pelo usuário
   * @param accountId - ID da conta/perfil ativo (opcional, do header x-account)
   */
  async processMessage(
    userId: string,
    messageText: string,
    accountId?: string,
  ): Promise<WebChatResponse> {
    this.logger.log(
      `📝 [WebChat] Processando mensagem - userId: ${userId}, accountId: ${accountId || 'default'}`,
    );

    try {
      // 1. Buscar usuário pelo gastoCertoId
      let user = await this.userCacheService.getUserByGastoCertoId(userId);

      // 2. Se não existir, criar automaticamente (usuário já está autenticado via JWT)
      if (!user) {
        this.logger.log(
          `🆕 [WebChat] Usuário ${userId} não encontrado no cache. Criando registro automaticamente...`,
        );

        try {
          // Buscar dados do usuário na API do GastoCerto
          const apiUser = await this.gastoCertoApi.getUserById(userId);

          if (!apiUser) {
            this.logger.error(`❌ [WebChat] Usuário ${userId} não encontrado na API GastoCerto`);
            return {
              success: false,
              messageType: 'error',
              message: this.removeEmojis(
                '❌ Erro ao criar seu perfil. Tente novamente mais tarde.',
              ),
              formatting: {
                color: 'error',
              },
            };
          }

          // Definir phoneNumber único para webchat
          apiUser.phoneNumber = `webchat-${userId}`;

          // Criar cache do usuário
          user = await this.userCacheService.createUserCache(apiUser);

          this.logger.log(
            `✅ [WebChat] Usuário criado automaticamente: ${user.name} (${user.gastoCertoId})`,
          );
        } catch (createError) {
          this.logger.error(`❌ [WebChat] Erro ao criar usuário ${userId}:`, createError);
          return {
            success: false,
            messageType: 'error',
            message: this.removeEmojis('❌ Erro ao criar seu perfil. Tente novamente mais tarde.'),
            formatting: {
              color: 'error',
            },
          };
        }
      }

      // GARANTIR que o phoneNumber seja webchat-{userId} para usuários webchat
      const expectedPhoneNumber = `webchat-${userId}`;

      // Se o phoneNumber do usuário não está no formato correto, atualizar
      if (user.phoneNumber !== expectedPhoneNumber) {
        this.logger.log(
          `🔄 [WebChat] Atualizando phoneNumber: ${user.phoneNumber} → ${expectedPhoneNumber}`,
        );

        // Atualizar phoneNumber no banco para garantir consistência
        user = await this.userCacheService.updateUserCache(user.gastoCertoId, {
          phoneNumber: expectedPhoneNumber,
        });
      }

      const phoneNumber = expectedPhoneNumber;
      this.logger.log(
        `✅ [WebChat] Usuário encontrado: ${user.name} (${phoneNumber}) | AccountId do header: ${accountId || 'default'}`,
      );

      // accountId é passado diretamente para as transações sem alterar o banco

      // 2. Comandos de perfil
      const lowerMessage = messageText.toLowerCase().trim();

      // 2.1. Comando para ver perfil atual (permitido)
      const isShowProfileCommand = WEBCHAT_SHOW_PROFILE_COMMANDS.some((cmd) =>
        lowerMessage.includes(cmd),
      );

      if (isShowProfileCommand) {
        this.logger.log(`ℹ️ [WebChat] Comando de visualização de perfil: ${messageText}`);
        return await this.showCurrentProfile(userId, accountId);
      }

      // 2.2. Barrar comandos de gerenciamento de perfil no webchat
      // O usuário deve fazer isso via interface gráfica
      const isManagementCommand = WEBCHAT_MANAGEMENT_COMMANDS.some((cmd) =>
        lowerMessage.includes(cmd),
      );

      if (isManagementCommand) {
        this.logger.log(`🚫 [WebChat] Comando de perfil bloqueado: ${messageText}`);
        return {
          success: false,
          messageType: 'info',
          message: this.removeEmojis(
            '💡 Para gerenciar seus perfis, utilize o menu de seleção de perfis na interface.\n\n' +
              'Você pode alternar entre seus perfis diretamente na tela, sem precisar enviar comandos.',
          ),
          formatting: {
            emoji: '💡',
            color: 'info',
          },
        };
      }

      // 3. Verificar se há contexto de aprendizado pendente
      const learningStatus = await this.messageLearningService.hasPendingLearning(phoneNumber);
      const hasLearningContext = learningStatus.hasPending;

      if (hasLearningContext) {
        this.logger.log(`🎓 [WebChat] Usuário tem contexto de aprendizado pendente`);

        const learningResult = await this.messageLearningService.processLearningMessage(
          phoneNumber,
          messageText,
        );

        if (learningResult.success) {
          // Se deve processar transação original após aprendizado
          if (learningResult.shouldProcessOriginalTransaction && learningResult.originalText) {
            this.logger.log(`🔄 [WebChat] Processando transação original após aprendizado`);

            const transactionResult = await this.messageLearningService.processOriginalTransaction(
              phoneNumber,
              learningResult.originalText,
              `webchat-${Date.now()}`,
              user,
              'webchat', // WebChat é uma plataforma própria
            );

            return this.formatTransactionResponse(transactionResult, learningResult.message);
          }

          // Aprendizado concluído, retornar opções se houver
          return this.formatLearningResponse(learningResult);
        }
      }

      // 4. Processar como mensagem de transação normal
      this.logger.log(`💰 [WebChat] Processando como transação normal`);

      const result = await this.transactionsService.processTextMessage(
        user, // Passa objeto user completo ao invés de phoneNumber
        messageText,
        `webchat-${Date.now()}`,
        'webchat', // WebChat é uma plataforma própria
        undefined, // platformId
        accountId, // accountId contextual do header
      );

      return this.formatTransactionResponse(result);
    } catch (error) {
      this.logger.error(`❌ [WebChat] Erro ao processar mensagem:`, error);
      throw error;
    }
  }

  /**
   * Formata resposta de transação para o frontend
   */
  private formatTransactionResponse(result: any, additionalMessage?: string): WebChatResponse {
    // Detectar tipo de resposta baseado no resultado
    let messageType: WebChatResponse['messageType'] = 'info';
    let color: 'success' | 'warning' | 'info' | 'error' = 'info';

    if (result.requiresConfirmation) {
      messageType = 'confirmation';
      color = 'warning';
    } else if (result.success) {
      messageType = 'transaction';
      color = 'success';
    } else if (!result.success && result.message.includes('❌')) {
      messageType = 'error';
      color = 'error';
    }

    // Extrair dados da transação se disponível
    const data: WebChatResponse['data'] = {};

    if (result.requiresConfirmation) {
      data.requiresConfirmation = true;
      data.confirmationId = result.confirmationId;
    }

    // Tentar extrair valores da mensagem (formato comum: "R$ 50,00")
    const amountMatch = result.message.match(/R\$\s*([\d.,]+)/);
    if (amountMatch) {
      data.amount = parseFloat(amountMatch[1].replace('.', '').replace(',', '.'));
    }

    // Extrair categoria se mencionada
    const categoryMatch = result.message.match(/categoria[:\s]+([^\n]+)/i);
    if (categoryMatch) {
      data.category = categoryMatch[1].trim();
    }

    // Combinar mensagens se houver mensagem adicional (do aprendizado)
    const finalMessage = additionalMessage
      ? `${additionalMessage}\n\n${result.message}`
      : result.message;

    return {
      success: result.success,
      messageType,
      message: this.removeEmojis(finalMessage),
      data: Object.keys(data).length > 0 ? data : undefined,
      formatting: {
        color,
        highlight: this.extractHighlights(finalMessage),
      },
    };
  }

  /**
   * Formata resposta de aprendizado RAG para o frontend
   */
  private formatLearningResponse(result: any): WebChatResponse {
    const data: WebChatResponse['data'] = {};

    // Se houver opções de aprendizado, incluir no data
    if (result.learningOptions) {
      data.learningOptions = result.learningOptions;
    }

    return {
      success: result.success,
      messageType: 'learning',
      message: this.removeEmojis(result.message),
      data: Object.keys(data).length > 0 ? data : undefined,
      formatting: {
        color: 'info',
        highlight: this.extractHighlights(result.message),
      },
    };
  }

  /**
   * Extrai partes importantes do texto para destacar no frontend
   * Ex: valores monetários, categorias, datas
   */
  private extractHighlights(message: string): string[] {
    const highlights: string[] = [];

    // Extrair valores monetários (R$ 50,00)
    const amounts = message.match(/R\$\s*[\d.,]+/g);
    if (amounts) {
      highlights.push(...amounts);
    }

    // Extrair categorias comuns
    const categories = [
      'supermercado',
      'transporte',
      'alimentação',
      'saúde',
      'educação',
      'lazer',
      'moradia',
      'outros',
    ];

    categories.forEach((cat) => {
      if (message.toLowerCase().includes(cat)) {
        // Encontrar a palavra completa no texto original (mantém capitalização)
        const regex = new RegExp(`\\b${cat}\\b`, 'i');
        const match = message.match(regex);
        if (match) {
          highlights.push(match[0]);
        }
      }
    });

    // Extrair datas (dd/mm/yyyy ou variações)
    const dates = message.match(/\d{1,2}\/\d{1,2}(?:\/\d{2,4})?/g);
    if (dates) {
      highlights.push(...dates);
    }

    return [...new Set(highlights)]; // Remove duplicatas
  }

  /**
   * Processa upload de imagem (nota fiscal, comprovante)
   * USA O MESMO FLUXO que WhatsApp/Telegram via TransactionsService
   */
  async processImageUpload(
    userId: string,
    file: Multer.File,
    _additionalMessage?: string,
    _accountId?: string,
  ): Promise<UploadResponse> {
    this.logger.log(
      `📷 [WebChat] Processando imagem - userId: ${userId}, fileName: ${file.originalname}`,
    );

    try {
      // Validar que o buffer existe
      if (!file.buffer) {
        this.logger.error(
          `❌ [WebChat] Buffer da imagem está undefined - fileName: ${file.originalname}`,
        );
        return {
          success: false,
          messageType: 'error',
          message: this.removeEmojis(
            'Erro ao processar imagem. Arquivo não foi carregado corretamente.',
          ),
          formatting: { color: 'error' },
        };
      }

      // 1. Buscar ou criar usuário
      let user = await this.userCacheService.getUserByGastoCertoId(userId);
      if (!user) {
        this.logger.log(`🆕 [WebChat] Criando usuário ${userId} automaticamente...`);
        const apiUser = await this.gastoCertoApi.getUserById(userId);
        if (!apiUser) {
          throw new Error('Usuário não encontrado na API GastoCerto');
        }
        apiUser.phoneNumber = `webchat-${userId}`;
        await this.userCacheService.createUserCache(apiUser);
        user = await this.userCacheService.getUserByGastoCertoId(userId);
      }

      const phoneNumber = `webchat-${userId}`;
      this.logger.log(
        `✅ [WebChat] Usuário imagem: ${user.name} | AccountId: ${_accountId || 'default'}`,
      );

      // accountId é passado diretamente para as transações sem alterar o banco

      // 2. DELEGAR para TransactionsService (mesmo fluxo WhatsApp/Telegram)
      const imageBuffer = file.buffer;
      const mimeType = file.mimetype;
      const messageId = `webchat-${Date.now()}`;

      // Log detalhado para debug
      this.logger.log(
        `📊 [WebChat] Detalhes da imagem - Size: ${(imageBuffer.length / 1024).toFixed(2)} KB, MimeType: ${mimeType}, OriginalName: ${file.originalname}`,
      );

      const result = await this.transactionsService.processImageMessage(
        user, // Passar objeto user completo
        imageBuffer,
        mimeType,
        messageId,
        'webchat', // WebChat é uma plataforma própria
        phoneNumber, // platformId para replies
        _accountId, // accountId contextual do header
      );

      // 3. Formatar resposta para frontend (remover emojis)
      return {
        success: result.success,
        messageType: this.mapMessageType(result),
        message: this.removeEmojis(result.message),
        data: {
          fileName: file.originalname,
          fileSize: file.size,
          requiresConfirmation: result.requiresConfirmation,
          confirmationId: result.confirmationId,
        },
        formatting: {
          color: result.success ? 'success' : 'error',
        },
      };
    } catch (error) {
      this.logger.error(`❌ [WebChat] Erro ao processar imagem:`, error);
      return {
        success: false,
        messageType: 'error',
        message: this.removeEmojis('Erro ao processar imagem. Tente novamente.'),
        formatting: { color: 'error' },
      };
    }
  }

  /**
   * Processa upload de áudio (mensagem de voz)
   * USA O MESMO FLUXO que WhatsApp/Telegram via TransactionsService
   */
  async processAudioUpload(
    userId: string,
    file: Multer.File,
    _additionalMessage?: string,
    _accountId?: string,
  ): Promise<UploadResponse> {
    this.logger.log(
      `🎤 [WebChat] Processando áudio - userId: ${userId}, fileName: ${file.originalname}`,
    );

    try {
      // Validar que o buffer existe
      if (!file.buffer) {
        this.logger.error(
          `❌ [WebChat] Buffer do áudio está undefined - fileName: ${file.originalname}`,
        );
        return {
          success: false,
          messageType: 'error',
          message: this.removeEmojis(
            'Erro ao processar áudio. Arquivo não foi carregado corretamente.',
          ),
          formatting: { color: 'error' },
        };
      }

      // 1. Buscar ou criar usuário
      let user = await this.userCacheService.getUserByGastoCertoId(userId);
      if (!user) {
        this.logger.log(`🆕 [WebChat] Criando usuário ${userId} automaticamente...`);
        const apiUser = await this.gastoCertoApi.getUserById(userId);
        if (!apiUser) {
          throw new Error('Usuário não encontrado na API GastoCerto');
        }
        apiUser.phoneNumber = `webchat-${userId}`;
        await this.userCacheService.createUserCache(apiUser);
        user = await this.userCacheService.getUserByGastoCertoId(userId);
      }

      const phoneNumber = `webchat-${userId}`;
      this.logger.log(
        `✅ [WebChat] Usuário áudio: ${user.name} | AccountId: ${_accountId || 'default'}`,
      );

      // accountId é passado diretamente para as transações sem alterar o banco

      // 2. DELEGAR para TransactionsService (mesmo fluxo WhatsApp/Telegram)
      const audioBuffer = file.buffer;
      const mimeType = file.mimetype;
      const messageId = `webchat-${Date.now()}`;

      const result = await this.transactionsService.processAudioMessage(
        user, // Passar objeto user completo
        audioBuffer,
        mimeType,
        messageId,
        'webchat', // WebChat é uma plataforma própria
        phoneNumber, // platformId para replies
        _accountId, // accountId contextual do header
      );

      // 3. Formatar resposta para frontend (remover emojis)
      return {
        success: result.success,
        messageType: this.mapMessageType(result),
        message: this.removeEmojis(result.message),
        data: {
          fileName: file.originalname,
          fileSize: file.size,
          requiresConfirmation: result.requiresConfirmation,
          confirmationId: result.confirmationId,
        },
        formatting: {
          color: result.success ? 'success' : 'error',
        },
      };
    } catch (error) {
      this.logger.error(`❌ [WebChat] Erro ao processar áudio:`, error);
      return {
        success: false,
        messageType: 'error',
        message: this.removeEmojis('Erro ao processar áudio. Tente novamente.'),
        formatting: { color: 'error' },
      };
    }
  }

  /**
   * Mapeia resultado de ProcessMessageResult para messageType do frontend
   */
  private mapMessageType(
    result: any,
  ): 'transaction' | 'confirmation' | 'learning' | 'info' | 'error' {
    if (!result.success) return 'error';
    if (result.requiresConfirmation) return 'confirmation';
    if (result.success && result.message.includes('registrada')) return 'transaction';
    return 'info';
  }

  /**
   * Busca contas do usuário com cache Redis
   * Cache TTL: 5 minutos
   */
  private async getUserAccountsWithCache(userId: string): Promise<any[]> {
    const cacheKey = `${this.ACCOUNTS_CACHE_PREFIX}${userId}`;

    try {
      // Tentar buscar do cache
      if (this.redisService.isReady()) {
        const cached = await this.redisService.getClient().get(cacheKey);
        if (cached) {
          this.logger.debug(`📦 [WebChat] Contas encontradas no cache: ${userId}`);
          return JSON.parse(cached);
        }
      }
    } catch (cacheError) {
      this.logger.warn(`⚠️ [WebChat] Erro ao buscar cache: ${cacheError.message}`);
    }

    // Buscar da API
    this.logger.debug(`🌐 [WebChat] Buscando contas da API: ${userId}`);
    const accounts = await this.gastoCertoApi.getUserAccounts(userId);

    // Salvar no cache
    try {
      if (this.redisService.isReady() && accounts) {
        await this.redisService
          .getClient()
          .setex(cacheKey, this.ACCOUNTS_CACHE_TTL, JSON.stringify(accounts));
        this.logger.debug(`✅ [WebChat] Contas salvas no cache: ${userId}`);
      }
    } catch (cacheError) {
      this.logger.warn(`⚠️ [WebChat] Erro ao salvar cache: ${cacheError.message}`);
    }

    return accounts;
  }

  /**
   * Invalida cache de contas do usuário
   * Usar quando o usuário trocar de perfil ou atualizar contas
   */
  async invalidateAccountsCache(userId: string): Promise<void> {
    const cacheKey = `${this.ACCOUNTS_CACHE_PREFIX}${userId}`;
    try {
      if (this.redisService.isReady()) {
        await this.redisService.getClient().del(cacheKey);
        this.logger.log(`🗑️  [WebChat] Cache invalidado: ${userId}`);
      }
    } catch (error) {
      this.logger.warn(`⚠️ [WebChat] Erro ao invalidar cache: ${error.message}`);
    }
  }

  /**
   * Mostra o perfil/conta atual em uso no WebChat
   * Segue o mesmo padrão do WhatsApp/Telegram: busca da API GastoCerto
   * e compara com o x-account do header
   * @param userId - ID do usuário no GastoCerto
   * @param accountId - ID da conta do header x-account (pode ser undefined)
   */
  private async showCurrentProfile(userId: string, accountId?: string): Promise<WebChatResponse> {
    try {
      this.logger.log(
        `🔍 [WebChat] Buscando perfil - userId: ${userId}, x-account header: ${accountId || 'não fornecido'}`,
      );

      // Buscar contas do usuário com cache Redis (fonte confiável)
      const accounts = await this.getUserAccountsWithCache(userId);

      if (!accounts || accounts.length === 0) {
        return {
          success: true,
          messageType: 'info',
          message: this.removeEmojis('Você ainda não possui perfis cadastrados.'),
          formatting: {
            color: 'info',
          },
        };
      }

      // Se accountId foi fornecido no header, validar e mostrar esse perfil
      if (accountId) {
        const currentAccount = accounts.find((acc) => acc.id === accountId);

        if (currentAccount) {
          this.logger.log(`✅ [WebChat] Perfil do x-account encontrado: ${currentAccount.name}`);
          return {
            success: true,
            messageType: 'info',
            message: this.removeEmojis(
              `Você está trabalhando no perfil:\n\n` +
                `${currentAccount.name}\n\n` +
                `Todas as transações nesta sessão serão registradas neste perfil.`,
            ),
            data: {
              currentAccount: {
                id: currentAccount.id,
                name: currentAccount.name,
              },
            },
            formatting: {
              color: 'info',
            },
          };
        } else {
          // AccountId no header não encontrado nas contas do usuário
          this.logger.warn(
            `⚠️ [WebChat] x-account ${accountId} não encontrado nas contas do usuário ${userId}`,
          );
          return {
            success: false,
            messageType: 'error',
            message: this.removeEmojis(
              `Perfil selecionado não encontrado.\n\n` +
                `Por favor, selecione um perfil válido no menu.`,
            ),
            formatting: {
              color: 'error',
            },
          };
        }
      }

      // Se não tem accountId no header, informar que precisa selecionar
      this.logger.log(
        `ℹ️ [WebChat] Nenhum x-account fornecido. Usuário tem ${accounts.length} perfil(is)`,
      );
      return {
        success: true,
        messageType: 'info',
        message: this.removeEmojis(
          `Para visualizar o perfil atual, por favor selecione um perfil no menu da interface.\n\n` +
            `Você possui ${accounts.length} perfil(is) disponível(is).`,
        ),
        formatting: {
          color: 'info',
        },
      };
    } catch (error) {
      this.logger.error(`❌ [WebChat] Erro ao buscar perfil atual:`, error);
      return {
        success: false,
        messageType: 'error',
        message: this.removeEmojis('Erro ao buscar informações do perfil.'),
        formatting: {
          color: 'error',
        },
      };
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { TransactionsService } from '@features/transactions/transactions.service';
import { UserCacheService } from '@features/users/user-cache.service';
import { MessageLearningService } from '@features/transactions/message-learning.service';
import { GastoCertoApiService } from '@shared/gasto-certo-api.service';
import { WebChatResponse } from './webchat.controller';
import { UploadResponse } from './dto/upload.dto';
import type { Multer } from 'multer';

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
 */
@Injectable()
export class WebChatService {
  private readonly logger = new Logger(WebChatService.name);

  constructor(
    private readonly transactionsService: TransactionsService,
    private readonly userCacheService: UserCacheService,
    private readonly messageLearningService: MessageLearningService,
    private readonly gastoCertoApi: GastoCertoApiService,
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
      this.logger.log(`✅ [WebChat] Usuário encontrado: ${user.name} (${phoneNumber})`);

      // 1.5. SINCRONIZAR accountId do header com activeAccountId do usuário
      if (accountId && accountId !== user.activeAccountId) {
        this.logger.log(
          `🔄 [WebChat] Sincronizando accountId do header: ${accountId} (anterior: ${user.activeAccountId})`,
        );

        const updatedUser = await this.userCacheService.switchAccount(phoneNumber, accountId);

        if (!updatedUser) {
          this.logger.error(
            `❌ [WebChat] Erro ao trocar conta para ${accountId}. Conta pode não existir para o usuário.`,
          );
          return {
            success: false,
            messageType: 'error',
            message: this.removeEmojis('❌ Erro ao selecionar conta. Verifique se a conta existe.'),
            formatting: {
              color: 'error',
            },
          };
        }

        // Atualizar referência do usuário
        user = updatedUser;
        this.logger.log(`✅ [WebChat] Conta ativa sincronizada: ${accountId}`);
      }

      // 2. Verificar se há contexto de aprendizado pendente
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

      // 3. Processar como mensagem de transação normal
      this.logger.log(`💰 [WebChat] Processando como transação normal`);

      const result = await this.transactionsService.processTextMessage(
        user, // Passa objeto user completo ao invés de phoneNumber
        messageText,
        `webchat-${Date.now()}`,
        'webchat', // WebChat é uma plataforma própria
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

      // 1.5. SINCRONIZAR accountId do header com activeAccountId do usuário
      if (_accountId && _accountId !== user.activeAccountId) {
        this.logger.log(
          `🔄 [WebChat] Sincronizando accountId do header na imagem: ${_accountId} (anterior: ${user.activeAccountId})`,
        );

        const updatedUser = await this.userCacheService.switchAccount(phoneNumber, _accountId);

        if (!updatedUser) {
          this.logger.error(
            `❌ [WebChat] Erro ao trocar conta para ${_accountId}. Conta pode não existir para o usuário.`,
          );
          return {
            success: false,
            messageType: 'error',
            message: this.removeEmojis('Erro ao selecionar conta. Verifique se a conta existe.'),
            formatting: { color: 'error' },
          };
        }

        // Atualizar referência do usuário
        user = updatedUser;
        this.logger.log(`✅ [WebChat] Conta ativa sincronizada na imagem: ${_accountId}`);
      }

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

      // 1.5. SINCRONIZAR accountId do header com activeAccountId do usuário
      if (_accountId && _accountId !== user.activeAccountId) {
        this.logger.log(
          `🔄 [WebChat] Sincronizando accountId do header no áudio: ${_accountId} (anterior: ${user.activeAccountId})`,
        );

        const updatedUser = await this.userCacheService.switchAccount(phoneNumber, _accountId);

        if (!updatedUser) {
          this.logger.error(
            `❌ [WebChat] Erro ao trocar conta para ${_accountId}. Conta pode não existir para o usuário.`,
          );
          return {
            success: false,
            messageType: 'error',
            message: this.removeEmojis('Erro ao processar áudio. Verifique se a conta existe.'),
            formatting: { color: 'error' },
          };
        }

        // Atualizar referência do usuário
        user = updatedUser;
        this.logger.log(`✅ [WebChat] Conta ativa sincronizada no áudio: ${_accountId}`);
      }

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
}

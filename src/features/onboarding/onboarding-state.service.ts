import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';
import { OnboardingSession, OnboardingStep } from '@prisma/client';
import { OnboardingData, OnboardingResponse } from './dto/onboarding.dto';
import { EmailValidator } from './validators/email.validator';
import { NameValidator } from './validators/name.validator';
import { PhoneValidator } from './validators/phone.validator';
import { IntentMatcher } from '@infrastructure/nlp/services/intent-matcher.service';
import {
  VERIFICATION_CODE_INTENTS,
  CONFIRMATION_INTENTS,
  PHONE_REQUEST_INTENTS,
  NEGATIVE_INTENTS,
} from './constants/onboarding-intents.constant';

@Injectable()
export class OnboardingStateService {
  private readonly logger = new Logger(OnboardingStateService.name);
  private readonly TIMEOUT_MS = 1800000; // 30 minutos

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailValidator: EmailValidator,
    private readonly nameValidator: NameValidator,
    private readonly phoneValidator: PhoneValidator,
  ) {}

  /**
   * Inicia novo fluxo de onboarding
   */
  /**
   * Reativa usuário inativo iniciando onboarding em REQUEST_VERIFICATION_CODE
   * Usado quando usuário com isActive=false tenta enviar mensagem
   */
  async reactivateUser(
    phoneNumber: string,
    platform?: 'telegram' | 'whatsapp',
  ): Promise<OnboardingResponse> {
    this.logger.log(
      `\n========================================\n` +
        `🔄 [REACTIVATION] Iniciando reativação\n` +
        `========================================\n` +
        `platformId: ${phoneNumber}\n` +
        `platform: ${platform}\n` +
        `========================================`,
    );

    // Deletar qualquer sessão antiga (completa ou não) para este platformId
    await this.prisma.onboardingSession.deleteMany({
      where: { platformId: phoneNumber },
    });

    this.logger.log(`🗑️ Sessões antigas deletadas para platformId: ${phoneNumber}`);

    // Criar nova sessão começando em REQUEST_VERIFICATION_CODE
    const session = await this.prisma.onboardingSession.create({
      data: {
        platformId: phoneNumber,
        currentStep: OnboardingStep.REQUEST_VERIFICATION_CODE,
        completed: false,
        data: {},
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutos
      },
    });

    this.logger.log(
      `✅ Sessão de reativação criada:\n` +
        `  - id: ${session.id}\n` +
        `  - currentStep: ${session.currentStep}`,
    );

    return this.buildResponse(session);
  }

  async startOnboarding(
    phoneNumber: string,
    platform?: 'telegram' | 'whatsapp',
  ): Promise<OnboardingResponse> {
    try {
      this.logger.log(
        `\n========================================\n` +
          `🚀 [ONBOARDING] START ONBOARDING\n` +
          `========================================\n` +
          `platformId: ${phoneNumber}\n` +
          `platform: ${platform}\n` +
          `========================================`,
      );
      
      // Verificar se já existe sessão ativa
      this.logger.log(`🔍 Verificando sessão ativa (completed=false)...`);
      const existingSession = await this.getActiveSession(phoneNumber);

      if (existingSession && !this.isExpired(existingSession)) {
        this.logger.log(
          `ℹ️ Sessão ativa encontrada:\n` +
            `  - id: ${existingSession.id}\n` +
            `  - currentStep: ${existingSession.currentStep}\n` +
            `  - completed: ${existingSession.completed}`,
        );
        return this.buildResponse(existingSession);
      }
      
      this.logger.log(`ℹ️ Nenhuma sessão ativa encontrada`);

      // 🆕 CRÍTICO: Verificar se já existe sessão COMPLETA
      this.logger.log(`🔍 Verificando sessão completa (completed=true)...`);
      const completedSession = await this.prisma.onboardingSession.findFirst({
        where: { platformId: phoneNumber, completed: true },
        orderBy: { createdAt: 'desc' },
      });

      if (completedSession) {
        this.logger.warn(
          `⚠️ ATENÇÃO: Usuário já completou onboarding mas não está no cache:\n` +
            `  - id: ${completedSession.id}\n` +
            `  - platformId: ${completedSession.platformId}\n` +
            `  - currentStep: ${completedSession.currentStep}\n` +
            `  - completed: ${completedSession.completed}\n` +
            `  🔧 AÇÃO: Deletando sessão completa para permitir novo onboarding\n` +
            `========================================`,
        );
        
        // Deletar a sessão completa para permitir novo onboarding
        await this.prisma.onboardingSession.delete({
          where: { id: completedSession.id },
        });
        
        this.logger.log(`✅ Sessão completa deletada - prosseguindo com novo onboarding`);
      } else {
        this.logger.log(`ℹ️ Nenhuma sessão completa encontrada - OK para criar nova`);
      }

      // Preparar dados iniciais com platform
      const initialData: any = {};
      if (platform) {
        initialData.platform = platform;
      }

      // Criar nova sessão (não usar upsert para evitar resetar sessões completas)
      this.logger.log(`📝 Criando nova sessão de onboarding...`);
      const session = await this.prisma.onboardingSession.create({
        data: {
          platformId: phoneNumber, // Telegram chatId ou WhatsApp number
          phoneNumber: null, // Será preenchido quando coletar o telefone
          currentStep: OnboardingStep.COLLECT_NAME,
          data: initialData,
          expiresAt: new Date(Date.now() + this.TIMEOUT_MS),
          completed: false,
          attempts: 0,
        },
      });

      this.logger.log(
        `✅ Nova sessão criada:\n` +
          `  - id: ${session.id}\n` +
          `  - platformId: ${session.platformId}\n` +
          `  - currentStep: ${session.currentStep}\n` +
          `  - completed: ${session.completed}\n` +
          `========================================`,
      );

      return {
        completed: false,
        currentStep: OnboardingStep.COLLECT_NAME,
        message: this.getWelcomeMessage(),
        data: initialData,
      };
    } catch (error) {
      this.logger.error('Erro ao iniciar onboarding:', error);
      throw error;
    }
  }

  /**
   * Processa mensagem do usuário no fluxo de onboarding
   */
  async processMessage(
    phoneNumber: string,
    message: string,
    metadata?: any,
  ): Promise<OnboardingResponse> {
    try {
      this.logger.log(
        `\n========================================\n` +
          `💬 [ONBOARDING] PROCESS MESSAGE\n` +
          `========================================\n` +
          `platformId: ${phoneNumber}\n` +
          `message: ${message.substring(0, 50)}...\n` +
          `========================================`,
      );
      
      this.logger.log(`🔍 Buscando sessão ativa...`);
      const session = await this.getActiveSession(phoneNumber);

      if (!session) {
        this.logger.log(`ℹ️ Nenhuma sessão ativa encontrada`);
        
        // 🆕 Verificar se usuário já completou onboarding
        this.logger.log(`🔍 Verificando se já completou onboarding...`);
        const completedSession = await this.prisma.onboardingSession.findFirst({
          where: { platformId: phoneNumber, completed: true },
          orderBy: { createdAt: 'desc' },
        });

        if (completedSession) {
          this.logger.warn(
            `❌ BLOQUEADO: Usuário já completou onboarding:\n` +
              `  - id: ${completedSession.id}\n` +
              `  - platformId: ${completedSession.platformId}\n` +
              `  - currentStep: ${completedSession.currentStep}\n` +
              `  - completed: ${completedSession.completed}\n` +
              `========================================`,
          );
          return {
            completed: true,
            currentStep: OnboardingStep.COMPLETED,
            message: '✅ Seu cadastro já foi concluído.',
            data: completedSession.data as any,
          };
        }
        
        this.logger.log(`ℹ️ Nenhuma sessão completa encontrada - iniciando novo onboarding`);

        // Usuário novo sem sessão - iniciar novo onboarding
        return this.startOnboarding(phoneNumber);
      }
      
      this.logger.log(
        `✅ Sessão ativa encontrada:\n` +
          `  - id: ${session.id}\n` +
          `  - currentStep: ${session.currentStep}\n` +
          `  - completed: ${session.completed}`,
      );

      // Verificar expiração
      if (this.isExpired(session)) {
        this.logger.warn(
          `⚠️ Sessão expirada para ${phoneNumber} - deletando e recomeçando onboarding`,
        );

        // Deletar sessão expirada ao invés de reativar
        await this.prisma.onboardingSession.delete({
          where: { id: session.id },
        });

        // Iniciar novo onboarding do zero
        return this.startOnboarding(phoneNumber, (session.data as any)?.platform);
      }

      // Processar baseado no step atual
      switch (session.currentStep) {
        case OnboardingStep.COLLECT_NAME:
          return this.handleNameCollection(session, message);

        case OnboardingStep.COLLECT_EMAIL:
          return this.handleEmailCollection(session, message);

        case OnboardingStep.REQUEST_PHONE:
          return this.handlePhoneRequest(session, message, metadata);

        case OnboardingStep.CHECK_EXISTING_USER:
          // Este step é processado automaticamente pelo OnboardingService
          return this.buildResponse(session);

        case OnboardingStep.REQUEST_VERIFICATION_CODE:
          return this.handleVerificationCodeRequest(session, message);

        case OnboardingStep.VERIFY_CODE:
          return this.handleCodeVerification(session, message);

        case OnboardingStep.CONFIRM_DATA:
          return this.handleDataConfirmation(session, message);

        case OnboardingStep.CREATING_ACCOUNT:
          // Este step é processado automaticamente pelo OnboardingService
          return this.buildResponse(session);

        default:
          this.logger.warn(`Step desconhecido: ${session.currentStep}`);
          return this.buildResponse(session);
      }
    } catch (error) {
      this.logger.error('Erro ao processar mensagem:', error);
      throw error;
    }
  }

  /**
   * Processa coleta de nome
   */
  private async handleNameCollection(
    session: OnboardingSession,
    message: string,
  ): Promise<OnboardingResponse> {
    const validation = this.nameValidator.validate(message);

    if (!validation.isValid) {
      // Incrementar tentativas
      await this.incrementAttempts(session.id);

      return {
        completed: false,
        currentStep: OnboardingStep.COLLECT_NAME,
        message: `❌ ${validation.error}\n\nPor favor, tente novamente:`,
      };
    }

    // Verificar se parece real
    if (!this.nameValidator.seemsReal(validation.normalizedName!)) {
      await this.incrementAttempts(session.id);

      return {
        completed: false,
        currentStep: OnboardingStep.COLLECT_NAME,
        message: '❌ Por favor, informe seu nome real.\n\nDigite seu nome completo:',
      };
    }

    // Salvar nome e avançar para coleta de email
    const data = (session.data as OnboardingData) || {};
    data.name = validation.normalizedName!;

    const updated = await this.updateSessionById(session.id, {
      currentStep: OnboardingStep.COLLECT_EMAIL,
      data: data as any,
    });

    return {
      completed: false,
      currentStep: OnboardingStep.COLLECT_EMAIL,
      message: `Prazer em conhecer você, ${data.name}! 😊\n\nAgora preciso do seu *email* para finalizar o cadastro:`,
      data,
    };
  }

  /**
   * Processa coleta de email
   */
  private async handleEmailCollection(
    session: OnboardingSession,
    message: string,
  ): Promise<OnboardingResponse> {
    // Converter email para minúsculo antes de validar
    const emailLowerCase = message.trim().toLowerCase();
    const validation = this.emailValidator.validate(emailLowerCase);

    if (!validation.isValid) {
      // Verificar se há sugestão de correção
      const suggestion = this.emailValidator.suggestCorrection(message);
      let errorMessage = `❌ ${validation.error}`;

      if (suggestion) {
        errorMessage += `\n\n💡 Você quis dizer: *${suggestion}*?\n\nPor favor, confirme ou digite novamente:`;
      } else {
        errorMessage += '\n\nPor favor, tente novamente:';
      }

      await this.incrementAttempts(session.id);

      return {
        completed: false,
        currentStep: OnboardingStep.COLLECT_EMAIL,
        message: errorMessage,
      };
    }

    // Salvar email e avançar para solicitação de telefone (TODAS PLATAFORMAS)
    const data = (session.data as OnboardingData) || {};
    data.email = validation.normalizedEmail!;

    // 🆕 TODOS usuários passam por REQUEST_PHONE (WhatsApp e Telegram)
    // Isso garante consistência entre plataformas
    const updated = await this.updateSessionById(session.id, {
      currentStep: OnboardingStep.REQUEST_PHONE,
      data: data as any,
    });

    return {
      completed: false,
      currentStep: OnboardingStep.REQUEST_PHONE,
      message:
        '📞 *Quase lá!*\n\n' +
        'Para finalizarmos, preciso do seu *número de telefone*.\n\n' +
        '🔒 *Seu telefone estará seguro!*\n' +
        'Use o botão abaixo para compartilhá-lo de forma segura.\n\n' +
        '💡 Você também pode digitar seu número no formato:\n' +
        '   • (11) 98765-4321\n' +
        '   • 11987654321\n' +
        '   • 5511987654321',
      data,
    };
  }

  /**
   * Processa solicitação de telefone (Telegram)
   * Aceita compartilhamento de contato ou número digitado manualmente
   * TELEFONE É OBRIGATÓRIO - não permite mais pular
   */
  private async handlePhoneRequest(
    session: OnboardingSession,
    message: string,
    metadata?: any,
  ): Promise<OnboardingResponse> {
    const data = (session.data as OnboardingData) || {};

    this.logger.log(`[handlePhoneRequest] Mensagem recebida: "${message}"`);

    // Analisar intenção do usuário (incluindo intents negativos)
    const allIntents = [...PHONE_REQUEST_INTENTS, ...NEGATIVE_INTENTS];
    const intent = await IntentMatcher.matchIntent(message, allIntents);
    this.logger.log(
      `Intent detectado: ${intent.intent} (confiança: ${(intent.confidence * 100).toFixed(1)}%)`,
    );

    // Verificar se usuário quer cancelar
    if (intent.matched && intent.intent === 'cancel') {
      this.logger.log('Usuário solicitou cancelamento');
      return {
        completed: false,
        currentStep: OnboardingStep.REQUEST_PHONE,
        message:
          '❌ *Cadastro cancelado*\n\n' +
          'Se mudar de ideia, é só começar novamente digitando "oi".\n\n' +
          'Até logo! 👋',
        data,
      };
    }

    // Telefone é obrigatório - não aceita mais pular
    if (intent.matched && intent.intent === 'skip') {
      this.logger.log('Usuário tentou pular telefone - não permitido');
      return {
        completed: false,
        currentStep: OnboardingStep.REQUEST_PHONE,
        message:
          '⚠️ *Telefone obrigatório*\n\n' +
          'Precisamos do seu telefone para completar o cadastro.\n\n' +
          '📞 Use o botão "Compartilhar Telefone" abaixo\n' +
          'ou digite seu número.\n\n' +
          '💡 Exemplo: (11) 98765-4321',
        data,
      };
    }

    // Verificar se recebeu telefone via contact sharing
    if (metadata?.phoneNumber) {
      this.logger.log(`Telefone recebido via contact: ${metadata.phoneNumber}`);

      data.realPhoneNumber = metadata.phoneNumber;

      const updated = await this.updateSessionById(session.id, {
        phoneNumber: metadata.phoneNumber, // Atualizar telefone real na sessão
        currentStep: OnboardingStep.CHECK_EXISTING_USER,
        data: data as any,
      });

      return {
        completed: false,
        currentStep: OnboardingStep.CHECK_EXISTING_USER,
        message: `✅ Telefone recebido!\n\n⏳ Verificando seu cadastro...`,
        data,
      };
    }

    // Intent de ajuda
    if (intent.matched && intent.intent === 'help') {
      return {
        completed: false,
        currentStep: OnboardingStep.REQUEST_PHONE,
        message:
          '❓ *Como compartilhar seu telefone:*\n\n' +
          '1️⃣ Clique no botão 📞 "Compartilhar Telefone" abaixo\n' +
          '2️⃣ O Telegram pedirá permissão - clique em "OK"\n' +
          '3️⃣ Seu telefone será enviado de forma segura\n\n' +
          '� *Ou digite seu número manualmente:*\n' +
          '   • (11) 98765-4321\n' +
          '   • 11987654321\n' +
          '   • 5511987654321\n\n' +
          '🔒 *Seu número estará protegido!*',
        data,
      };
    }

    // Tentar validar se usuário digitou um número de telefone manualmente
    const phoneValidation = this.phoneValidator.validate(message);
    if (phoneValidation.isValid) {
      this.logger.log(`Telefone válido digitado: ${phoneValidation.formattedPhone}`);

      data.realPhoneNumber = phoneValidation.normalizedPhone;

      await this.updateSessionById(session.id, {
        phoneNumber: phoneValidation.normalizedPhone, // Atualizar telefone real na sessão
        currentStep: OnboardingStep.CHECK_EXISTING_USER,
        data: data as any,
      });

      return {
        completed: false,
        currentStep: OnboardingStep.CHECK_EXISTING_USER,
        message: `✅ Telefone ${phoneValidation.formattedPhone} recebido!\n\n⏳ Verificando seu cadastro...`,
        data,
      };
    }

    // Se tentou digitar número mas está inválido, mostrar erro específico
    if (phoneValidation.error && /\d/.test(message)) {
      this.logger.log(`Telefone inválido digitado: ${message}`);
      return {
        completed: false,
        currentStep: OnboardingStep.REQUEST_PHONE,
        message: phoneValidation.error,
        data,
      };
    }

    // Se recebeu texto inválido, explicar novamente
    return {
      completed: false,
      currentStep: OnboardingStep.REQUEST_PHONE,
      message:
        '❌ *Não consegui entender*\n\n' +
        '📞 Use o *botão "Compartilhar telefone"* abaixo\n' +
        'ou digite um número de telefone válido.\n\n' +
        '💡 Exemplos válidos:\n' +
        '   • (11) 98765-4321\n' +
        '   • 11 98765-4321\n' +
        '   • 5511987654321\n\n' +
        'Digite *"ajuda"* para mais informações.',
      data,
    };
  }

  /**
   * Processa solicitação de código de verificação
   * Permite reenviar código ou corrigir email
   */
  private async handleVerificationCodeRequest(
    session: OnboardingSession,
    message: string,
  ): Promise<OnboardingResponse> {
    const data = session.data as OnboardingData;

    this.logger.log(`[handleVerificationCodeRequest] Mensagem recebida: "${message}"`);

    // Detectar intenção da mensagem (incluindo intents negativos)
    const allIntents = [...VERIFICATION_CODE_INTENTS, ...NEGATIVE_INTENTS];
    const intent = await IntentMatcher.matchIntent(message, allIntents);
    this.logger.log(
      `Intent detectado: ${intent.intent} (confiança: ${(intent.confidence * 100).toFixed(1)}%)`,
    );

    // Reenviar código
    if (intent.matched && intent.intent === 'resend_code') {
      return {
        completed: false,
        currentStep: OnboardingStep.REQUEST_VERIFICATION_CODE,
        message: '📨 Reenviando código de verificação...\n\nAguarde um momento.',
        data: { ...data, resendCode: true },
      };
    }

    // Corrigir email
    if (intent.matched && intent.intent === 'correct_email') {
      // Voltar para coleta de email
      await this.updateSessionById(session.id, {
        currentStep: OnboardingStep.COLLECT_EMAIL,
        data: { name: data.name, platform: data.platform } as any,
      });

      return {
        completed: false,
        currentStep: OnboardingStep.COLLECT_EMAIL,
        message: '✏️ Ok! Vamos corrigir seu email.\n\nPor favor, informe o email correto:',
        data: { name: data.name },
      };
    }

    // Normalizar mensagem para extrair código (remove espaços e não-dígitos)
    const cleanedCode = message.replace(/\D/g, '');

    // Se parecer um código (6 dígitos após limpeza)
    if (/^\d{6}$/.test(cleanedCode)) {
      this.logger.log(`✅ Código válido detectado: ${cleanedCode}`);
      
      // Avançar para verificação
      const updatedData = { ...data, verificationCode: cleanedCode };
      await this.updateSessionById(session.id, {
        currentStep: OnboardingStep.VERIFY_CODE,
        data: updatedData as any,
      });

      return {
        completed: false,
        currentStep: OnboardingStep.VERIFY_CODE,
        message: '🔍 Verificando código...',
        data: updatedData,
      };
    }
    
    // Se tentou enviar um código mas formato está errado
    if (/\d{5,7}/.test(cleanedCode)) {
      this.logger.warn(`⚠️ Código com formato incorreto: "${message}" (limpo: "${cleanedCode}")`);
      return {
        completed: false,
        currentStep: OnboardingStep.REQUEST_VERIFICATION_CODE,
        message:
          `⚠️ *Formato incorreto*\n\n` +
          `O código deve ter exatamente 6 dígitos.\n` +
          `Você digitou: ${message}\n\n` +
          `Por favor, digite novamente o código de 6 dígitos.`,
        data,
      };
    }

    // Mensagem de ajuda
    return {
      completed: false,
      currentStep: OnboardingStep.REQUEST_VERIFICATION_CODE,
      message:
        `❓ Não entendi. Você pode:\n\n` +
        `📨 *Digite o código* de 6 dígitos que enviamos para ${data.email}\n` +
        `🔄 Digite *"reenviar"* para receber um novo código\n` +
        `✏️ Digite *"corrigir email"* se o email está errado\n\n` +
        `O que deseja fazer?`,
      data,
    };
  }

  /**
   * Processa verificação de código
   * Este step é processado automaticamente pelo OnboardingService
   */
  private async handleCodeVerification(
    session: OnboardingSession,
    message: string,
  ): Promise<OnboardingResponse> {
    const data = session.data as OnboardingData;

    // Se o OnboardingService não processar, dar feedback ao usuário
    return {
      completed: false,
      currentStep: OnboardingStep.VERIFY_CODE,
      message: '⏳ Verificando seu código...\n\nAguarde um momento.',
      data,
    };
  }

  /**
   * Processa confirmação de dados
   */
  private async handleDataConfirmation(
    session: OnboardingSession,
    message: string,
  ): Promise<OnboardingResponse> {
    const data = session.data as OnboardingData;

    this.logger.log(`[handleDataConfirmation] Mensagem recebida: "${message}"`);

    // Detectar intenção do usuário (incluindo intents negativos)
    const allIntents = [...CONFIRMATION_INTENTS, ...NEGATIVE_INTENTS];
    const intent = await IntentMatcher.matchIntent(message, allIntents);
    this.logger.log(
      `Intent confirmado: ${intent.intent} (confiança: ${(intent.confidence * 100).toFixed(1)}%)`,
    );

    // Verificar resposta afirmativa
    if (intent.matched && intent.intent === 'confirm') {
      // Marcar como pronto para criar conta
      const updated = await this.updateSessionById(session.id, {
        currentStep: OnboardingStep.CREATING_ACCOUNT,
        data: data as any,
      });

      return {
        completed: false,
        currentStep: OnboardingStep.CREATING_ACCOUNT,
        message: '⏳ Perfeito! Estou criando sua conta no GastoCerto...',
        data,
      };
    }

    // Verificar resposta negativa (recomeçar)
    if (intent.matched && intent.intent === 'restart') {
      // Reiniciar fluxo
      const updated = await this.updateSessionById(session.id, {
        currentStep: OnboardingStep.COLLECT_NAME,
        data: { platform: data.platform },
        attempts: 0,
      });

      return {
        completed: false,
        currentStep: OnboardingStep.COLLECT_NAME,
        message: 'Tranquilo! Vamos corrigir então. 😊\n\nQual é o seu *nome completo*?',
      };
    }

    // Resposta inválida
    return {
      completed: false,
      currentStep: OnboardingStep.CONFIRM_DATA,
      message:
        '❓ Não entendi sua resposta.\n\n' +
        'Por favor, responda:\n' +
        '✅ *"Sim"* para confirmar\n' +
        '❌ *"Não"* para corrigir',
    };
  }

  /**
   * Marca onboarding como completo
   */
  async completeOnboarding(platformId: string, userCacheId?: string): Promise<void> {
    try {
      this.logger.log(
        `\n========================================\n` +
          `✅ [ONBOARDING] COMPLETE ONBOARDING\n` +
          `========================================\n` +
          `platformId: ${platformId}\n` +
          `userCacheId: ${userCacheId || 'auto-lookup'}\n` +
          `========================================`,
      );

      // Auto-lookup userCacheId se não fornecido
      let resolvedUserCacheId = userCacheId;
      if (!resolvedUserCacheId) {
        const userCache = await this.prisma.userCache.findFirst({
          where: {
            OR: [
              { phoneNumber: platformId },
              { whatsappId: platformId },
              { telegramId: platformId },
            ],
          },
          select: { id: true },
        });
        resolvedUserCacheId = userCache?.id;
        if (resolvedUserCacheId) {
          this.logger.log(`🔗 Auto-linked userCacheId: ${resolvedUserCacheId}`);
        }
      }

      const updateData: any = {
        completed: true,
        currentStep: OnboardingStep.COMPLETED,
      };

      if (resolvedUserCacheId) {
        updateData.userCacheId = resolvedUserCacheId;
      }

      const result = await this.prisma.onboardingSession.updateMany({
        where: { platformId },
        data: updateData,
      });

      this.logger.log(
        `✅ Sessões atualizadas: ${result.count} registro(s)`,
      );

      // Verificar se realmente foi atualizado
      const updated = await this.prisma.onboardingSession.findFirst({
        where: { platformId },
        orderBy: { createdAt: 'desc' },
      });
      
      this.logger.log(
        `🔍 Verificação da última sessão:\n` +
          `  - id: ${updated?.id}\n` +
          `  - platformId: ${updated?.platformId}\n` +
          `  - currentStep: ${updated?.currentStep}\n` +
          `  - completed: ${updated?.completed}\n` +
          `========================================`,
      );
    } catch (error) {
      this.logger.error(`❌ Erro ao completar onboarding: ${error.message}`);
      throw error;
    }
  }

  /**
   * Busca sessão ativa de onboarding por platformId
   */
  async getActiveSession(platformId: string): Promise<OnboardingSession | null> {
    return this.prisma.onboardingSession.findFirst({
      where: {
        platformId,
        completed: false,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Atualiza sessão de onboarding (método interno)
   */
  private async updateSessionById(
    sessionId: string,
    data: Partial<OnboardingSession>,
  ): Promise<OnboardingSession> {
    return this.prisma.onboardingSession.update({
      where: { id: sessionId },
      data: {
        ...data,
        lastMessageAt: new Date(),
      },
    });
  }

  /**
   * Atualiza sessão de onboarding por telefone (método público)
   */
  async updateSession(
    phoneNumberOrId: string,
    data: Partial<{ currentStep: OnboardingStep; data?: any }>,
  ): Promise<OnboardingSession> {
    const session = await this.getActiveSession(phoneNumberOrId);
    if (!session) {
      throw new Error(`Sessão não encontrada para: ${phoneNumberOrId}`);
    }

    return this.prisma.onboardingSession.update({
      where: { id: session.id },
      data: {
        ...data,
        lastMessageAt: new Date(),
      },
    });
  }

  /**
   * Incrementa contador de tentativas
   */
  private async incrementAttempts(sessionId: string): Promise<void> {
    await this.prisma.onboardingSession.update({
      where: { id: sessionId },
      data: {
        attempts: { increment: 1 },
        lastMessageAt: new Date(),
      },
    });
  }

  /**
   * Expira sessão
   */
  private async expireSession(sessionId: string): Promise<void> {
    await this.prisma.onboardingSession.update({
      where: { id: sessionId },
      data: { completed: true },
    });
  }

  /**
   * Verifica se sessão expirou
   */
  private isExpired(session: OnboardingSession): boolean {
    return new Date() > session.expiresAt;
  }

  /**
   * Constrói resposta baseada na sessão atual
   */
  private buildResponse(session: OnboardingSession): OnboardingResponse {
    const data = session.data as OnboardingData;

    let message = '';

    switch (session.currentStep) {
      case OnboardingStep.COLLECT_NAME:
        message = this.getWelcomeMessage();
        break;
      case OnboardingStep.COLLECT_EMAIL:
        message = `Por favor, informe seu *email*:`;
        break;
      case OnboardingStep.CONFIRM_DATA:
        message = this.getConfirmationMessage(data);
        break;
      case OnboardingStep.COMPLETED:
        message = '✅ Seu cadastro já foi concluído!';
        break;
      default:
        message = 'Continuando seu cadastro...';
    }

    return {
      completed: session.completed,
      currentStep: session.currentStep,
      message,
      data,
    };
  }

  /**
   * Mensagem de boas-vindas
   */
  private getWelcomeMessage(): string {
    return `Olá! 👋 Que bom ter você aqui no *GastoCerto*!\n\nSou seu assistente financeiro e vou te ajudar a controlar seus gastos de forma simples e rápida.\n\nPara começar, qual é o seu *nome completo*?`;
  }

  /**
   * Mensagem de confirmação de dados
   */
  private getConfirmationMessage(data: OnboardingData): string {
    return `📋 Perfeito! Vamos confirmar seus dados:\n\n👤 *Nome:* ${data.name}\n📧 *Email:* ${data.email}\n\nEstá tudo certinho? Digite *sim* para continuar ou *não* para corrigir.`;
  }

  /**
   * Retorna apenas a pergunta do step atual (sem saudação)
   * Usado quando reativa sessão expirada
   */
  private getStepMessage(step: OnboardingStep, data: OnboardingData): string {
    switch (step) {
      case OnboardingStep.COLLECT_NAME:
        return '📝 Qual é o seu *nome completo*?';

      case OnboardingStep.COLLECT_EMAIL:
        return '📧 Agora, qual é o seu *email*?';

      case OnboardingStep.REQUEST_PHONE:
        return (
          '📞 Quase lá!\n\n' +
          'Para finalizarmos, preciso do seu *número de telefone*.\n\n' +
          '🔒 Seu telefone estará seguro!\n' +
          'Use o botão abaixo para compartilhá-lo de forma segura.\n\n' +
          '💡 Você também pode digitar seu número no formato:\n' +
          '   • (11) 98765-4321\n' +
          '   • 11987654321\n' +
          '   • 5511987654321'
        );

      case OnboardingStep.REQUEST_VERIFICATION_CODE:
        return (
          '📧 *Código enviado para seu email!*\n\n' +
          `Enviamos um código de verificação para *${data.email}*\n\n` +
          'Digite o código de 6 dígitos que você recebeu:\n\n' +
          '💡 *Opções:*\n' +
          '• Digite *"reenviar"* para receber um novo código\n' +
          '• Digite *"corrigir email"* se o email está errado'
        );

      case OnboardingStep.CONFIRM_DATA:
        return this.getConfirmationMessage(data);

      case OnboardingStep.CHECK_EXISTING_USER:
        return '⏳ Verificando seu cadastro...';

      case OnboardingStep.VERIFY_CODE:
        return '🔍 Verificando código...';

      case OnboardingStep.CREATING_ACCOUNT:
        return '✨ Criando sua conta...';

      case OnboardingStep.COMPLETED:
        return '✅ Seu cadastro já foi concluído!';

      default:
        return 'Continuando seu cadastro...';
    }
  }
}

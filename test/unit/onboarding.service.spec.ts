import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OnboardingService } from '@features/onboarding/onboarding.service';
import { OnboardingStateService } from '@features/onboarding/onboarding-state.service';
import { GastoCertoApiService } from '@shared/gasto-certo-api.service';
import { UserCacheService } from '@features/users/user-cache.service';
import { PrismaService } from '@core/database/prisma.service';
import { MessageContextService } from '@infrastructure/messaging/messages/services/message-context.service';
import { MessagingPlatform } from '@infrastructure/messaging/messaging-provider.interface';
import { MessageType } from '@infrastructure/messaging/message.interface';
import { RAGService } from '@infrastructure/rag/services/rag.service';

describe('OnboardingService', () => {
  let service: OnboardingService;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let onboardingState: jest.Mocked<OnboardingStateService>;
  let contextService: jest.Mocked<MessageContextService>;

  beforeEach(async () => {
    const eventEmitterMock = {
      emit: jest.fn(),
    };

    const onboardingStateMock = {
      processMessage: jest.fn(),
      startOnboarding: jest.fn(),
    };

    const contextServiceMock = {
      getContext: jest.fn(),
      registerContext: jest.fn(),
    };

    const gastoCertoApiMock = {
      checkExistingUser: jest.fn(),
      createUser: jest.fn(),
    };

    const userCacheMock = {
      getUser: jest.fn(),
      createUserCacheWithPlatform: jest.fn(),
    };

    const prismaMock = {
      onboardingSession: {
        findFirst: jest.fn(),
      },
    };

    const ragServiceMock = {
      findSimilarCategories: jest.fn(),
      learnFromCorrection: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnboardingService,
        { provide: OnboardingStateService, useValue: onboardingStateMock },
        { provide: GastoCertoApiService, useValue: gastoCertoApiMock },
        { provide: UserCacheService, useValue: userCacheMock },
        { provide: PrismaService, useValue: prismaMock },
        { provide: EventEmitter2, useValue: eventEmitterMock },
        { provide: MessageContextService, useValue: contextServiceMock },
        { provide: RAGService, useValue: ragServiceMock },
      ],
    }).compile();

    service = module.get<OnboardingService>(OnboardingService);
    eventEmitter = module.get(EventEmitter2);
    onboardingState = module.get(OnboardingStateService);
    contextService = module.get(MessageContextService);
  });

  describe('handleMessage', () => {
    it('deve emitir evento whatsapp.reply para mensagens do WhatsApp', async () => {
      // Mock context retornando WhatsApp
      contextService.getContext.mockReturnValue({
        sessionId: 'session-123',
        platform: MessagingPlatform.WHATSAPP,
        lastActivity: Date.now(),
        expiresAt: Date.now() + 3600000,
      });

      // Mock onboarding state
      onboardingState.processMessage.mockResolvedValue({
        completed: false,
        currentStep: 'COLLECT_EMAIL',
        message: 'Qual é o seu e-mail?',
        data: { name: 'João' },
      });

      // Processar mensagem
      await service.handleMessage({
        phoneNumber: '5566996285154',
        text: 'João Silva',
        type: MessageType.TEXT,
        timestamp: Date.now(),
        platform: MessagingPlatform.WHATSAPP,
        messageId: 'msg-123',
        isFromMe: false,
      });

      // Verificar evento emitido
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'whatsapp.reply',
        expect.objectContaining({
          platformId: '5566996285154',
          message: 'Qual é o seu e-mail?',
        }),
      );
    });

    it('deve emitir evento telegram.reply para mensagens do Telegram', async () => {
      // Mock context retornando Telegram
      contextService.getContext.mockReturnValue({
        sessionId: 'telegram-707624962',
        platform: MessagingPlatform.TELEGRAM,
        lastActivity: Date.now(),
        expiresAt: Date.now() + 3600000,
      });

      // Mock onboarding state
      onboardingState.processMessage.mockResolvedValue({
        completed: false,
        currentStep: 'COLLECT_EMAIL',
        message: 'Qual é o seu e-mail?',
        data: { name: 'Maria' },
      });

      // Processar mensagem
      await service.handleMessage({
        phoneNumber: '707624962',
        text: 'Maria Santos',
        type: MessageType.TEXT,
        timestamp: Date.now(),
        platform: MessagingPlatform.TELEGRAM,
        messageId: 'msg-456',
        isFromMe: false,
      });

      // Verificar evento emitido
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'telegram.reply',
        expect.objectContaining({
          platformId: '707624962',
          message: 'Qual é o seu e-mail?',
        }),
      );
    });

    it('deve usar WhatsApp como fallback quando contexto não encontrado', async () => {
      // Mock context retornando null
      contextService.getContext.mockReturnValue(null);

      // Mock onboarding state
      onboardingState.processMessage.mockResolvedValue({
        completed: false,
        currentStep: 'COLLECT_EMAIL',
        message: 'Qual é o seu e-mail?',
        data: { name: 'Pedro' },
      });

      // Processar mensagem
      await service.handleMessage({
        phoneNumber: '5566996285155',
        text: 'Pedro Costa',
        type: MessageType.TEXT,
        timestamp: Date.now(),
        platform: MessagingPlatform.WHATSAPP,
        messageId: 'msg-789',
        isFromMe: false,
      });

      // Verificar que usou WhatsApp como fallback
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'whatsapp.reply',
        expect.any(Object),
      );
    });
  });
});

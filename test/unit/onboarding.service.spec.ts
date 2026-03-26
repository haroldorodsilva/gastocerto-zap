import { Test, TestingModule } from '@nestjs/testing';
import { OnboardingService } from '@features/onboarding/onboarding.service';
import { OnboardingStateService } from '@features/onboarding/onboarding-state.service';
import { GastoCertoApiService } from '@shared/gasto-certo-api.service';
import { UserCacheService } from '@features/users/user-cache.service';
import { PrismaService } from '@core/database/prisma.service';
import { PlatformReplyService } from '@infrastructure/messaging/messages/platform-reply.service';
import { MessagingPlatform } from '@infrastructure/messaging/messaging-provider.interface';
import { MessageType } from '@infrastructure/messaging/message.interface';
import { RAGService } from '@infrastructure/rag/services/rag.service';

describe('OnboardingService', () => {
  let service: OnboardingService;
  let onboardingState: jest.Mocked<OnboardingStateService>;
  let platformReply: jest.Mocked<PlatformReplyService>;

  beforeEach(async () => {
    const onboardingStateMock = {
      processMessage: jest.fn(),
      startOnboarding: jest.fn(),
      updateSession: jest.fn(),
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

    const platformReplyMock = {
      sendReply: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnboardingService,
        { provide: OnboardingStateService, useValue: onboardingStateMock },
        { provide: GastoCertoApiService, useValue: gastoCertoApiMock },
        { provide: UserCacheService, useValue: userCacheMock },
        { provide: PrismaService, useValue: prismaMock },
        { provide: PlatformReplyService, useValue: platformReplyMock },
        { provide: RAGService, useValue: ragServiceMock },
      ],
    }).compile();

    service = module.get<OnboardingService>(OnboardingService);
    onboardingState = module.get(OnboardingStateService);
    platformReply = module.get(PlatformReplyService);
  });

  describe('handleMessage', () => {
    it('deve enviar reply via PlatformReplyService para mensagens do WhatsApp', async () => {
      onboardingState.processMessage.mockResolvedValue({
        completed: false,
        currentStep: 'COLLECT_EMAIL',
        message: 'Qual é o seu e-mail?',
        data: { name: 'João' },
      });

      await service.handleMessage({
        platformId: '5566996285154',
        phoneNumber: '5566996285154',
        text: 'João Silva',
        type: MessageType.TEXT,
        timestamp: Date.now(),
        platform: MessagingPlatform.WHATSAPP,
        messageId: 'msg-123',
        isFromMe: false,
      });

      expect(platformReply.sendReply).toHaveBeenCalledWith(
        expect.objectContaining({
          platformId: '5566996285154',
          message: 'Qual é o seu e-mail?',
        }),
      );
    });

    it('deve enviar reply via PlatformReplyService para mensagens do Telegram', async () => {
      onboardingState.processMessage.mockResolvedValue({
        completed: false,
        currentStep: 'COLLECT_EMAIL',
        message: 'Qual é o seu e-mail?',
        data: { name: 'Maria' },
      });

      await service.handleMessage({
        platformId: '707624962',
        phoneNumber: '707624962',
        text: 'Maria Santos',
        type: MessageType.TEXT,
        timestamp: Date.now(),
        platform: MessagingPlatform.TELEGRAM,
        messageId: 'msg-456',
        isFromMe: false,
      });

      expect(platformReply.sendReply).toHaveBeenCalledWith(
        expect.objectContaining({
          platformId: '707624962',
          message: 'Qual é o seu e-mail?',
        }),
      );
    });

    it('não deve enviar reply quando mensagem não tem texto', async () => {
      await service.handleMessage({
        platformId: '5566996285155',
        phoneNumber: '5566996285155',
        type: MessageType.TEXT,
        timestamp: Date.now(),
        platform: MessagingPlatform.WHATSAPP,
        messageId: 'msg-789',
        isFromMe: false,
      });

      expect(platformReply.sendReply).not.toHaveBeenCalled();
    });
  });
});

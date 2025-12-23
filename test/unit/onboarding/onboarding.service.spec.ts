import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OnboardingService } from '../../../src/features/onboarding/onboarding.service';
import { OnboardingStateService } from '../../../src/features/onboarding/onboarding-state.service';
import { GastoCertoApiService } from '../../../src/shared/gasto-certo-api.service';
import { UserCacheService } from '../../../src/features/users/user-cache.service';
import { PrismaService } from '../../../src/core/database/prisma.service';
import { MessageContextService } from '../../../src/infrastructure/whatsapp/messages/message-context.service';

describe('OnboardingService', () => {
  let service: OnboardingService;
  let onboardingState: jest.Mocked<OnboardingStateService>;
  let gastoCertoApi: jest.Mocked<GastoCertoApiService>;
  let userCache: jest.Mocked<UserCacheService>;
  let prisma: jest.Mocked<PrismaService>;

  const mockOnboardingState = {
    processMessage: jest.fn(),
    completeOnboarding: jest.fn(),
    updateSession: jest.fn(),
    getActiveSession: jest.fn(),
  };

  const mockGastoCertoApi = {
    validateAuthCode: jest.fn(),
    getUserByEmail: jest.fn(),
    requestAuthCode: jest.fn(),
    createUser: jest.fn(),
  };

  const mockUserCache = {
    createUserCacheWithPlatform: jest.fn(),
    getUser: jest.fn(),
    syncUser: jest.fn(),
  };

  const mockPrisma = {
    onboardingSession: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      update: jest.fn().mockResolvedValue({
        id: '707624962',
        isActive: true,
        isBlocked: false,
      }),
    },
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  const mockContextService = {
    getContext: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnboardingService,
        { provide: OnboardingStateService, useValue: mockOnboardingState },
        { provide: GastoCertoApiService, useValue: mockGastoCertoApi },
        { provide: UserCacheService, useValue: mockUserCache },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: MessageContextService, useValue: mockContextService },
      ],
    }).compile();

    service = module.get<OnboardingService>(OnboardingService);
    onboardingState = module.get(OnboardingStateService);
    gastoCertoApi = module.get(GastoCertoApiService);
    userCache = module.get(UserCacheService);
    prisma = module.get(PrismaService);

    jest.clearAllMocks();
  });

  describe('processOnboardingMessage - VERIFY_CODE', () => {
    const platformId = '707624962';
    const realPhoneNumber = '66996285154';
    const validCode = '482776';

    it('deve completar onboarding quando código é válido', async () => {
      const mockResponse = {
        currentStep: 'VERIFY_CODE',
        data: {
          name: 'Haroldo Silva',
          email: 'test@test.com',
          realPhoneNumber,
          verificationCode: validCode,
          platform: 'telegram',
        },
      };

      onboardingState.processMessage.mockResolvedValue(mockResponse as any);
      gastoCertoApi.validateAuthCode.mockResolvedValue({
        success: true,
        user: {
          id: 'user-123',
          name: 'Haroldo Silva',
          email: 'test@test.com',
          phoneNumber: realPhoneNumber,
        },
      } as any);
      userCache.createUserCacheWithPlatform.mockResolvedValue(undefined);
      onboardingState.completeOnboarding.mockResolvedValue(undefined);

      const result = await service.processOnboardingMessage(platformId, validCode);

      // Verificar que completeOnboarding foi chamado com platformId
      expect(onboardingState.completeOnboarding).toHaveBeenCalledWith(platformId);
      
      // Verificar que a response indica conclusão
      expect(result.response.completed).toBe(true);
      expect(result.response.currentStep).toBe('COMPLETED');
    });

    it('deve criar cache com platformId e realPhoneNumber separados', async () => {
      const mockResponse = {
        currentStep: 'VERIFY_CODE',
        data: {
          name: 'Haroldo Silva',
          email: 'test@test.com',
          realPhoneNumber,
          verificationCode: validCode,
          platform: 'telegram',
        },
      };

      const mockUser = {
        id: 'user-123',
        name: 'Haroldo Silva',
        email: 'test@test.com',
        phoneNumber: realPhoneNumber,
      };

      onboardingState.processMessage.mockResolvedValue(mockResponse as any);
      gastoCertoApi.validateAuthCode.mockResolvedValue({
        success: true,
        user: mockUser,
      } as any);
      userCache.createUserCacheWithPlatform.mockResolvedValue(undefined);
      onboardingState.completeOnboarding.mockResolvedValue(undefined);

      await service.processOnboardingMessage(platformId, validCode);

      // Verificar que cache foi criado com parâmetros corretos
      expect(userCache.createUserCacheWithPlatform).toHaveBeenCalledWith(
        mockUser,
        'telegram',
        platformId, // ID da plataforma (chatId)
        realPhoneNumber, // Telefone real
      );
    });

    it('deve validar código usando realPhoneNumber, não platformId', async () => {
      const mockResponse = {
        currentStep: 'VERIFY_CODE',
        data: {
          name: 'Haroldo Silva',
          email: 'test@test.com',
          realPhoneNumber,
          verificationCode: validCode,
          platform: 'telegram',
        },
      };

      onboardingState.processMessage.mockResolvedValue(mockResponse as any);
      gastoCertoApi.validateAuthCode.mockResolvedValue({
        success: true,
        user: { id: 'user-123' },
      } as any);
      userCache.createUserCacheWithPlatform.mockResolvedValue(undefined);
      onboardingState.completeOnboarding.mockResolvedValue(undefined);

      await service.processOnboardingMessage(platformId, validCode);

      // CRÍTICO: API deve receber telefone real, não chatId
      expect(gastoCertoApi.validateAuthCode).toHaveBeenCalledWith({
        email: 'test@test.com',
        phoneNumber: realPhoneNumber, // Telefone real
        code: validCode,
      });

      // Garantir que NÃO usou platformId como phoneNumber
      const apiCall = gastoCertoApi.validateAuthCode.mock.calls[0][0];
      expect(apiCall.phoneNumber).not.toBe(platformId);
      expect(apiCall.phoneNumber).toBe(realPhoneNumber);
    });

    it('deve falhar se realPhoneNumber não foi coletado', async () => {
      const mockResponse = {
        currentStep: 'VERIFY_CODE',
        data: {
          name: 'Haroldo Silva',
          email: 'test@test.com',
          // realPhoneNumber ausente!
          verificationCode: validCode,
          platform: 'telegram',
        },
      };

      onboardingState.processMessage.mockResolvedValue(mockResponse as any);

      const result = await service.processOnboardingMessage(platformId, validCode);

      // Não deve chamar API se não tem telefone real
      expect(gastoCertoApi.validateAuthCode).not.toHaveBeenCalled();
      
      // Não deve completar onboarding
      expect(onboardingState.completeOnboarding).not.toHaveBeenCalled();
    });

    it('deve voltar para REQUEST_VERIFICATION_CODE se código inválido', async () => {
      const mockResponse = {
        currentStep: 'VERIFY_CODE',
        data: {
          name: 'Haroldo Silva',
          email: 'test@test.com',
          realPhoneNumber,
          verificationCode: '999999',
          platform: 'telegram',
        },
      };

      onboardingState.processMessage.mockResolvedValue(mockResponse as any);
      gastoCertoApi.validateAuthCode.mockResolvedValue({
        success: false,
        message: 'Código inválido',
      } as any);
      onboardingState.updateSession.mockResolvedValue(undefined);

      const result = await service.processOnboardingMessage(platformId, '999999');

      // Não deve completar onboarding
      expect(onboardingState.completeOnboarding).not.toHaveBeenCalled();

      // Deve atualizar sessão para REQUEST_VERIFICATION_CODE
      expect(onboardingState.updateSession).toHaveBeenCalledWith(platformId, {
        currentStep: 'REQUEST_VERIFICATION_CODE',
        data: mockResponse.data,
      });

      // Response deve indicar não completo
      expect(result.response.completed).toBe(false);
      expect(result.response.currentStep).toBe('REQUEST_VERIFICATION_CODE');
    });
  });

  describe('isUserOnboarding e checkUserExists', () => {
    const platformId = '707624962';

    it('deve retornar false após onboarding completo', async () => {
      // Sessão completa
      onboardingState.getActiveSession.mockResolvedValue(null);

      const result = await service.isUserOnboarding(platformId);

      expect(result).toBe(false);
      expect(onboardingState.getActiveSession).toHaveBeenCalledWith(platformId);
    });

    it('deve retornar true durante onboarding', async () => {
      // Sessão ativa
      onboardingState.getActiveSession.mockResolvedValue({
        id: 'session-123',
        platformId,
        completed: false,
      } as any);

      const result = await service.isUserOnboarding(platformId);

      expect(result).toBe(true);
    });

    it('deve verificar usuário no cache após onboarding', async () => {
      userCache.getUser.mockResolvedValue({
        userId: 'user-123',
        phoneNumber: '66996285154',
      } as any);

      const exists = await service.checkUserExists(platformId);

      expect(exists).toBe(true);
      expect(userCache.getUser).toHaveBeenCalledWith(platformId);
    });
  });

  describe('Fluxo de validação completo', () => {
    it('deve prevenir processamento como onboarding após conclusão', async () => {
      const platformId = '707624962';

      // 1. Durante onboarding - retorna sessão ativa
      onboardingState.getActiveSession.mockResolvedValueOnce({
        id: 'session-123',
        platformId,
        completed: false,
      } as any);

      let isOnboarding = await service.isUserOnboarding(platformId);
      expect(isOnboarding).toBe(true);

      // 2. Simular conclusão do onboarding
      onboardingState.completeOnboarding.mockResolvedValue(undefined);
      await onboardingState.completeOnboarding(platformId);

      // 3. Após conclusão - não deve retornar sessão ativa
      onboardingState.getActiveSession.mockResolvedValueOnce(null);

      isOnboarding = await service.isUserOnboarding(platformId);
      expect(isOnboarding).toBe(false);

      // 4. Deve encontrar usuário no cache
      userCache.getUser.mockResolvedValue({ userId: 'user-123' } as any);
      const userExists = await service.checkUserExists(platformId);
      expect(userExists).toBe(true);
    });
  });

  describe('createUserInApi', () => {
    it('deve usar realPhoneNumber ao criar usuário, não platformId', async () => {
      const platformId = '707624962';
      const realPhoneNumber = '66996285154';

      const mockResponse = {
        currentStep: 'CREATING_ACCOUNT',
        data: {
          name: 'Haroldo Silva',
          email: 'test@test.com',
          realPhoneNumber,
          platform: 'telegram',
        },
      };

      const mockUser = {
        id: 'user-123',
        name: 'Haroldo Silva',
        email: 'test@test.com',
        phoneNumber: realPhoneNumber,
      };

      onboardingState.processMessage.mockResolvedValue(mockResponse as any);
      gastoCertoApi.createUser.mockResolvedValue(mockUser as any);
      userCache.createUserCacheWithPlatform.mockResolvedValue(undefined);
      onboardingState.completeOnboarding.mockResolvedValue(undefined);

      await service.processOnboardingMessage(platformId, 'sim');

      // Verificar que createUser foi chamado com telefone real
      expect(gastoCertoApi.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          phoneNumber: realPhoneNumber,
          metadata: expect.objectContaining({
            telegramChatId: platformId,
          }),
        }),
      );

      // Garantir que NÃO enviou platformId como phoneNumber
      const createCall = gastoCertoApi.createUser.mock.calls[0][0];
      expect(createCall.phoneNumber).not.toBe(platformId);
    });
  });

  describe('cancelOnboarding', () => {
    it('deve usar platformId para cancelar, não phoneNumber', async () => {
      const platformId = '707624962';

      await service.cancelOnboarding(platformId);

      expect(prisma.onboardingSession.updateMany).toHaveBeenCalledWith({
        where: {
          platformId,
          completed: false,
        },
        data: {
          completed: true,
        },
      });
    });
  });
});

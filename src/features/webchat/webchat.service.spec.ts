import { Test, TestingModule } from '@nestjs/testing';
import { WebChatService } from './webchat.service';
import { TransactionsService } from '@features/transactions/transactions.service';
import { UserCacheService } from '@features/users/user-cache.service';
import { MessageLearningService } from '@features/transactions/message-learning.service';
import { GastoCertoApiService } from '@shared/gasto-certo-api.service';
import { RedisService } from '@common/services/redis.service';

describe('WebChatService - Profile Validation', () => {
  let service: WebChatService;
  let gastoCertoApiService: GastoCertoApiService;
  let redisService: RedisService;

  const mockUserId = 'user-123-456';
  const mockAccountId = 'account-abc-def';
  const mockAccounts = [
    { 
      id: 'account-abc-def', 
      name: 'Pessoal', 
      role: 'owner',
      isPrimary: true,
      isCreator: true
    },
    { 
      id: 'account-xyz-789', 
      name: 'Empresa', 
      role: 'admin',
      isPrimary: false,
      isCreator: false
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebChatService,
        {
          provide: TransactionsService,
          useValue: {
            processTextMessage: jest.fn(),
          },
        },
        {
          provide: UserCacheService,
          useValue: {
            getUserByGastoCertoId: jest.fn(),
            createUserCache: jest.fn(),
          },
        },
        {
          provide: MessageLearningService,
          useValue: {
            hasPendingLearning: jest.fn(),
          },
        },
        {
          provide: GastoCertoApiService,
          useValue: {
            getUserAccounts: jest.fn(),
            getUserById: jest.fn(),
          },
        },
        {
          provide: RedisService,
          useValue: {
            isReady: jest.fn().mockReturnValue(true),
            getClient: jest.fn().mockReturnValue({
              get: jest.fn(),
              setex: jest.fn(),
              del: jest.fn(),
            }),
          },
        },
      ],
    }).compile();

    service = module.get<WebChatService>(WebChatService);
    gastoCertoApiService = module.get<GastoCertoApiService>(GastoCertoApiService);
    redisService = module.get<RedisService>(RedisService);
  });

  describe('showCurrentProfile - Validação de x-account', () => {
    it('deve retornar perfil válido quando x-account pertence ao usuário', async () => {
      // Arrange
      jest.spyOn(gastoCertoApiService, 'getUserAccounts').mockResolvedValue(mockAccounts);
      jest.spyOn(redisService.getClient(), 'get').mockResolvedValue(null);

      // Act
      const result = await service['showCurrentProfile'](mockUserId, mockAccountId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.messageType).toBe('info');
      expect(result.message).toContain('Pessoal');
      expect(result.data?.currentAccount?.id).toBe(mockAccountId);
      expect(gastoCertoApiService.getUserAccounts).toHaveBeenCalledWith(mockUserId);
    });

    it('deve retornar erro quando x-account não pertence ao usuário', async () => {
      // Arrange
      const invalidAccountId = 'account-invalid-999';
      jest.spyOn(gastoCertoApiService, 'getUserAccounts').mockResolvedValue(mockAccounts);
      jest.spyOn(redisService.getClient(), 'get').mockResolvedValue(null);

      // Act
      const result = await service['showCurrentProfile'](mockUserId, invalidAccountId);

      // Assert
      expect(result.success).toBe(false);
      expect(result.messageType).toBe('error');
      expect(result.message).toContain('não encontrado');
    });

    it('deve pedir seleção quando x-account não é fornecido', async () => {
      // Arrange
      jest.spyOn(gastoCertoApiService, 'getUserAccounts').mockResolvedValue(mockAccounts);
      jest.spyOn(redisService.getClient(), 'get').mockResolvedValue(null);

      // Act
      const result = await service['showCurrentProfile'](mockUserId, undefined);

      // Assert
      expect(result.success).toBe(true);
      expect(result.messageType).toBe('info');
      expect(result.message).toContain('selecione um perfil');
      expect(result.message).toContain('2 perfil(is)');
    });

    it('deve informar quando usuário não tem perfis', async () => {
      // Arrange
      jest.spyOn(gastoCertoApiService, 'getUserAccounts').mockResolvedValue([]);
      jest.spyOn(redisService.getClient(), 'get').mockResolvedValue(null);

      // Act
      const result = await service['showCurrentProfile'](mockUserId, mockAccountId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.messageType).toBe('info');
      expect(result.message).toContain('não possui perfis');
    });
  });

  describe('Cache Redis - getUserAccountsWithCache', () => {
    it('deve buscar do cache quando disponível', async () => {
      // Arrange
      const cachedData = JSON.stringify(mockAccounts);
      jest.spyOn(redisService.getClient(), 'get').mockResolvedValue(cachedData);
      const apiSpy = jest.spyOn(gastoCertoApiService, 'getUserAccounts');

      // Act
      const result = await service['getUserAccountsWithCache'](mockUserId);

      // Assert
      expect(result).toEqual(mockAccounts);
      expect(redisService.getClient().get).toHaveBeenCalled();
      expect(apiSpy).not.toHaveBeenCalled(); // Não deve chamar API
    });

    it('deve buscar da API e salvar no cache quando cache vazio', async () => {
      // Arrange
      jest.spyOn(redisService.getClient(), 'get').mockResolvedValue(null);
      jest.spyOn(gastoCertoApiService, 'getUserAccounts').mockResolvedValue(mockAccounts);
      const setexSpy = jest.spyOn(redisService.getClient(), 'setex');

      // Act
      const result = await service['getUserAccountsWithCache'](mockUserId);

      // Assert
      expect(result).toEqual(mockAccounts);
      expect(gastoCertoApiService.getUserAccounts).toHaveBeenCalledWith(mockUserId);
      expect(setexSpy).toHaveBeenCalledWith(
        `webchat:accounts:${mockUserId}`,
        300, // TTL 5 min
        JSON.stringify(mockAccounts),
      );
    });

    it('deve continuar funcionando se Redis falhar', async () => {
      // Arrange
      jest.spyOn(redisService, 'isReady').mockReturnValue(false);
      jest.spyOn(gastoCertoApiService, 'getUserAccounts').mockResolvedValue(mockAccounts);

      // Act
      const result = await service['getUserAccountsWithCache'](mockUserId);

      // Assert
      expect(result).toEqual(mockAccounts);
      expect(gastoCertoApiService.getUserAccounts).toHaveBeenCalled();
    });
  });

  describe('Cache Invalidation', () => {
    it('deve invalidar cache quando solicitado', async () => {
      // Arrange
      const delSpy = jest.spyOn(redisService.getClient(), 'del').mockResolvedValue(1);

      // Act
      await service.invalidateAccountsCache(mockUserId);

      // Assert
      expect(delSpy).toHaveBeenCalledWith(`webchat:accounts:${mockUserId}`);
    });

    it('deve continuar se Redis falhar ao invalidar', async () => {
      // Arrange
      jest.spyOn(redisService, 'isReady').mockReturnValue(false);

      // Act & Assert - Não deve lançar erro
      await expect(service.invalidateAccountsCache(mockUserId)).resolves.not.toThrow();
    });
  });
});

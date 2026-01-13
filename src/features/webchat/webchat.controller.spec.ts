import { Test, TestingModule } from '@nestjs/testing';
import { WebChatController } from './webchat.controller';
import { WebChatService } from './webchat.service';
import { JwtUserGuard } from '@common/guards/jwt-user.guard';

describe('WebChatController - Integration Tests', () => {
  let controller: WebChatController;
  let service: WebChatService;

  const mockUser = {
    id: 'user-123-456',
    email: 'test@example.com',
  };

  const mockRequest = {
    user: mockUser,
  } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebChatController],
      providers: [
        {
          provide: WebChatService,
          useValue: {
            processMessage: jest.fn(),
            processImageUpload: jest.fn(),
            processAudioUpload: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(JwtUserGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<WebChatController>(WebChatController);
    service = module.get<WebChatService>(WebChatService);
  });

  describe('POST /webchat/message', () => {
    it('deve processar mensagem com x-account válido', async () => {
      // Arrange
      const dto = { message: 'perfil' };
      const accountId = 'account-abc-def';
      const expectedResponse = {
        success: true,
        messageType: 'info' as const,
        message: 'Você está trabalhando no perfil: Pessoal',
        data: {
          currentAccount: {
            id: accountId,
            name: 'Pessoal',
          },
        },
      };

      jest.spyOn(service, 'processMessage').mockResolvedValue(expectedResponse);

      // Act
      const result = await controller.sendMessage(dto, mockRequest, accountId);

      // Assert
      expect(service.processMessage).toHaveBeenCalledWith(mockUser.id, dto.message, accountId);
      expect(result).toEqual(expectedResponse);
    });

    it('deve processar mensagem sem x-account', async () => {
      // Arrange
      const dto = { message: 'gastei 100 no mercado' };
      const expectedResponse = {
        success: true,
        messageType: 'transaction' as const,
        message: 'Transação registrada com sucesso',
      };

      jest.spyOn(service, 'processMessage').mockResolvedValue(expectedResponse);

      // Act
      const result = await controller.sendMessage(dto, mockRequest, undefined);

      // Assert
      expect(service.processMessage).toHaveBeenCalledWith(mockUser.id, dto.message, undefined);
      expect(result).toEqual(expectedResponse);
    });

    it('deve retornar erro quando processamento falha', async () => {
      // Arrange
      const dto = { message: 'teste' };
      jest.spyOn(service, 'processMessage').mockRejectedValue(new Error('Erro de teste'));

      // Act
      const result = await controller.sendMessage(dto, mockRequest, undefined);

      // Assert
      expect(result.success).toBe(false);
      expect(result.messageType).toBe('error');
      expect(result.message).toContain('erro');
    });
  });

  describe('Validação de x-account', () => {
    it('deve validar x-account contra contas do usuário', async () => {
      // Arrange
      const dto = { message: 'perfil' };
      const invalidAccountId = 'account-invalid-999';

      jest.spyOn(service, 'processMessage').mockResolvedValue({
        success: false,
        messageType: 'error',
        message: 'Perfil selecionado não encontrado',
      });

      // Act
      const result = await controller.sendMessage(dto, mockRequest, invalidAccountId);

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toContain('não encontrado');
    });
  });
});

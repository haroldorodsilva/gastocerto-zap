import { Test, TestingModule } from '@nestjs/testing';
import { AICredentialSelectorService } from '@infrastructure/ai/credentials/ai-credential-selector.service';
import { PrismaService } from '@core/database/prisma.service';
import { CryptoService } from '@common/services/crypto.service';
import { AIProviderType } from '@infrastructure/ai/ai.interface';

const makeCred = (overrides: Partial<any> = {}) => ({
  id: 'cred-1',
  provider: 'openai',
  label: 'openai-key-1',
  apiKey: 'sk-encrypted-abc',
  priority: 1,
  isActive: true,
  isExhausted: false,
  exhaustedAt: null,
  exhaustedReason: null,
  lastUsedAt: null,
  totalRequests: 0,
  totalErrors: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('AICredentialSelectorService', () => {
  let service: AICredentialSelectorService;
  let prismaMock: jest.Mocked<{ aIProviderCredential: any }>;
  let cryptoMock: jest.Mocked<{ decrypt: jest.Mock }>;

  beforeEach(async () => {
    prismaMock = {
      aIProviderCredential: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    cryptoMock = {
      decrypt: jest.fn((val: string) => `decrypted-${val}`),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AICredentialSelectorService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CryptoService, useValue: cryptoMock },
      ],
    }).compile();

    service = module.get<AICredentialSelectorService>(AICredentialSelectorService);
  });

  // ─── pickNext ────────────────────────────────────────────────────────────

  describe('pickNext', () => {
    it('retorna credencial ativa/não-esgotada para provider válido', async () => {
      const cred = makeCred();
      prismaMock.aIProviderCredential.findFirst.mockResolvedValue(cred);

      const result = await service.pickNext(AIProviderType.OPENAI);

      expect(result).not.toBeNull();
      expect(result!.credentialId).toBe('cred-1');
      expect(result!.label).toBe('openai-key-1');
      expect(result!.provider).toBe('openai');
      // Chave descriptografada
      expect(result!.apiKey).toBe('decrypted-sk-encrypted-abc');
    });

    it('ordena por priority ASC e lastUsedAt ASC NULLS FIRST', async () => {
      const cred = makeCred();
      prismaMock.aIProviderCredential.findFirst.mockResolvedValue(cred);

      await service.pickNext(AIProviderType.OPENAI);

      expect(prismaMock.aIProviderCredential.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { provider: 'openai', isActive: true, isExhausted: false },
          orderBy: [
            { priority: 'asc' },
            { lastUsedAt: { sort: 'asc', nulls: 'first' } },
          ],
        }),
      );
    });

    it('retorna null quando não há credenciais disponíveis', async () => {
      prismaMock.aIProviderCredential.findFirst.mockResolvedValue(null);

      const result = await service.pickNext(AIProviderType.OPENAI);

      expect(result).toBeNull();
    });

    it('retorna null para provider sem mapeamento', async () => {
      const result = await service.pickNext('UNKNOWN_PROVIDER' as AIProviderType);
      expect(result).toBeNull();
    });

    it('usa chave em texto plano quando decrypt falha (setup inicial)', async () => {
      const cred = makeCred({ apiKey: 'plaintext-key' });
      prismaMock.aIProviderCredential.findFirst.mockResolvedValue(cred);
      cryptoMock.decrypt.mockImplementation(() => { throw new Error('bad decrypt'); });

      const result = await service.pickNext(AIProviderType.OPENAI);

      expect(result!.apiKey).toBe('plaintext-key');
    });

    it('mapeia provider GOOGLE_GEMINI corretamente para "google_gemini"', async () => {
      prismaMock.aIProviderCredential.findFirst.mockResolvedValue(null);

      await service.pickNext(AIProviderType.GOOGLE_GEMINI);

      expect(prismaMock.aIProviderCredential.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ provider: 'google_gemini' }) }),
      );
    });

    it('mapeia provider GROQ corretamente', async () => {
      prismaMock.aIProviderCredential.findFirst.mockResolvedValue(null);
      await service.pickNext(AIProviderType.GROQ);
      expect(prismaMock.aIProviderCredential.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ provider: 'groq' }) }),
      );
    });

    it('mapeia provider DEEPSEEK corretamente', async () => {
      prismaMock.aIProviderCredential.findFirst.mockResolvedValue(null);
      await service.pickNext(AIProviderType.DEEPSEEK);
      expect(prismaMock.aIProviderCredential.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ provider: 'deepseek' }) }),
      );
    });
  });

  // ─── listAvailable ───────────────────────────────────────────────────────

  describe('listAvailable', () => {
    it('retorna lista de credenciais disponíveis descriptografadas', async () => {
      const creds = [
        makeCred({ id: 'cred-1', label: 'key-1', apiKey: 'enc-key-1', priority: 1 }),
        makeCred({ id: 'cred-2', label: 'key-2', apiKey: 'enc-key-2', priority: 2 }),
      ];
      prismaMock.aIProviderCredential.findMany.mockResolvedValue(creds);

      const result = await service.listAvailable(AIProviderType.OPENAI);

      expect(result).toHaveLength(2);
      expect(result[0].credentialId).toBe('cred-1');
      expect(result[0].apiKey).toBe('decrypted-enc-key-1');
      expect(result[1].credentialId).toBe('cred-2');
      expect(result[1].apiKey).toBe('decrypted-enc-key-2');
    });

    it('retorna lista vazia quando não há credenciais', async () => {
      prismaMock.aIProviderCredential.findMany.mockResolvedValue([]);
      const result = await service.listAvailable(AIProviderType.OPENAI);
      expect(result).toEqual([]);
    });

    it('retorna lista vazia para provider sem mapeamento', async () => {
      const result = await service.listAvailable('UNKNOWN' as AIProviderType);
      expect(result).toEqual([]);
      expect(prismaMock.aIProviderCredential.findMany).not.toHaveBeenCalled();
    });

    it('inclui apenas credenciais isActive=true e isExhausted=false', async () => {
      prismaMock.aIProviderCredential.findMany.mockResolvedValue([]);

      await service.listAvailable(AIProviderType.OPENAI);

      expect(prismaMock.aIProviderCredential.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { provider: 'openai', isActive: true, isExhausted: false },
        }),
      );
    });
  });

  // ─── markUsed ───────────────────────────────────────────────────────────

  describe('markUsed', () => {
    it('atualiza lastUsedAt e incrementa totalRequests', async () => {
      prismaMock.aIProviderCredential.update.mockResolvedValue({});

      await service.markUsed('cred-1');

      expect(prismaMock.aIProviderCredential.update).toHaveBeenCalledWith({
        where: { id: 'cred-1' },
        data: {
          lastUsedAt: expect.any(Date),
          totalRequests: { increment: 1 },
        },
      });
    });

    it('não lança erro se update falhar (silencia)', async () => {
      prismaMock.aIProviderCredential.update.mockRejectedValue(new Error('DB offline'));
      await expect(service.markUsed('cred-1')).resolves.toBeUndefined();
    });
  });

  // ─── markError ──────────────────────────────────────────────────────────

  describe('markError', () => {
    it('incrementa totalErrors', async () => {
      prismaMock.aIProviderCredential.update.mockResolvedValue({});

      await service.markError('cred-1');

      expect(prismaMock.aIProviderCredential.update).toHaveBeenCalledWith({
        where: { id: 'cred-1' },
        data: { totalErrors: { increment: 1 } },
      });
    });

    it('não lança erro se update falhar (silencia)', async () => {
      prismaMock.aIProviderCredential.update.mockRejectedValue(new Error('DB offline'));
      await expect(service.markError('cred-1')).resolves.toBeUndefined();
    });
  });

  // ─── markExhausted ──────────────────────────────────────────────────────

  describe('markExhausted', () => {
    it('seta isExhausted=true, exhaustedAt e exhaustedReason', async () => {
      prismaMock.aIProviderCredential.update.mockResolvedValue({});

      await service.markExhausted('cred-1', 'quota exceeded on openai');

      expect(prismaMock.aIProviderCredential.update).toHaveBeenCalledWith({
        where: { id: 'cred-1' },
        data: {
          isExhausted: true,
          exhaustedAt: expect.any(Date),
          exhaustedReason: 'quota exceeded on openai',
        },
      });
    });

    it('trunca exhaustedReason em 250 caracteres', async () => {
      prismaMock.aIProviderCredential.update.mockResolvedValue({});
      const longReason = 'x'.repeat(300);

      await service.markExhausted('cred-1', longReason);

      const callArgs = prismaMock.aIProviderCredential.update.mock.calls[0][0];
      expect(callArgs.data.exhaustedReason).toHaveLength(250);
    });

    it('não lança erro se update falhar (silencia)', async () => {
      prismaMock.aIProviderCredential.update.mockRejectedValue(new Error('DB offline'));
      await expect(service.markExhausted('cred-1', 'rate limit')).resolves.toBeUndefined();
    });
  });

  // ─── resetExhausted ─────────────────────────────────────────────────────

  describe('resetExhausted', () => {
    it('limpa todos os flags exhausted e retorna a contagem', async () => {
      prismaMock.aIProviderCredential.updateMany.mockResolvedValue({ count: 3 });

      const count = await service.resetExhausted();

      expect(count).toBe(3);
      expect(prismaMock.aIProviderCredential.updateMany).toHaveBeenCalledWith({
        where: { isExhausted: true },
        data: { isExhausted: false, exhaustedAt: null, exhaustedReason: null },
      });
    });

    it('retorna 0 quando nenhuma credencial estava esgotada', async () => {
      prismaMock.aIProviderCredential.updateMany.mockResolvedValue({ count: 0 });
      const count = await service.resetExhausted();
      expect(count).toBe(0);
    });
  });

  // ─── isQuotaError (static) ───────────────────────────────────────────────

  describe('isQuotaError', () => {
    it('detecta status 429', () => {
      expect(AICredentialSelectorService.isQuotaError({ status: 429 })).toBe(true);
    });

    it('detecta statusCode 429', () => {
      expect(AICredentialSelectorService.isQuotaError({ statusCode: 429 })).toBe(true);
    });

    it('detecta response.status 429', () => {
      expect(AICredentialSelectorService.isQuotaError({ response: { status: 429 } })).toBe(true);
    });

    it('detecta mensagem "quota"', () => {
      expect(AICredentialSelectorService.isQuotaError({ message: 'insufficient_quota' })).toBe(true);
    });

    it('detecta mensagem "rate limit"', () => {
      expect(AICredentialSelectorService.isQuotaError({ message: 'rate limit exceeded' })).toBe(true);
    });

    it('detecta mensagem "rate_limit"', () => {
      expect(AICredentialSelectorService.isQuotaError({ message: 'rate_limit_exceeded' })).toBe(true);
    });

    it('detecta mensagem "billing"', () => {
      expect(AICredentialSelectorService.isQuotaError({ message: 'billing limit reached' })).toBe(true);
    });

    it('detecta mensagem "exceeded"', () => {
      expect(AICredentialSelectorService.isQuotaError({ message: 'exceeded daily limit' })).toBe(true);
    });

    it('retorna false para erros de rede comuns (não-quota)', () => {
      expect(AICredentialSelectorService.isQuotaError({ status: 500, message: 'internal server error' })).toBe(false);
    });

    it('retorna false para erros de autenticação (401)', () => {
      expect(AICredentialSelectorService.isQuotaError({ status: 401, message: 'unauthorized' })).toBe(false);
    });

    it('retorna false para null/undefined', () => {
      expect(AICredentialSelectorService.isQuotaError(null)).toBe(false);
      expect(AICredentialSelectorService.isQuotaError(undefined)).toBe(false);
    });

    it('retorna false para erro sem campos relevantes', () => {
      expect(AICredentialSelectorService.isQuotaError({ message: 'timeout' })).toBe(false);
    });
  });
});

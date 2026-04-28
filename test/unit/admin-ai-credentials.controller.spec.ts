/**
 * Smoke tests para AdminAICredentialsController.
 *
 * Cobrem os 6 endpoints do controller:
 * - GET  /admin/ai-credentials          → list (apiKey mascarada)
 * - GET  /admin/ai-credentials/status   → summary por provider
 * - POST /admin/ai-credentials          → criar credencial
 * - PUT  /admin/ai-credentials/:id      → atualizar (reativação limpa exhausted)
 * - DELETE /admin/ai-credentials/:id    → remover (bloqueia última ativa)
 * - POST /admin/ai-credentials/reset-exhausted → reset manual
 */

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AdminAICredentialsController } from '@features/admin/controllers/admin-ai-credentials.controller';
import { PrismaService } from '@core/database/prisma.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';

const NOW = new Date('2026-04-28T10:00:00Z');

function makeCred(overrides: Partial<any> = {}) {
  return {
    id: 'cred-1',
    provider: 'openai',
    label: 'openai-primary',
    apiKey: 'sk-abc1234567890xyz',
    priority: 1,
    isActive: true,
    isExhausted: false,
    exhaustedAt: null,
    exhaustedReason: null,
    lastUsedAt: null,
    totalRequests: 42,
    totalErrors: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('AdminAICredentialsController', () => {
  let controller: AdminAICredentialsController;
  let prismaMock: any;

  beforeEach(async () => {
    prismaMock = {
      aIProviderCredential: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminAICredentialsController],
      providers: [{ provide: PrismaService, useValue: prismaMock }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AdminAICredentialsController>(AdminAICredentialsController);
  });

  // ─── GET /admin/ai-credentials ───────────────────────────────────────────

  describe('listCredentials', () => {
    it('retorna lista com apiKey mascarada', async () => {
      prismaMock.aIProviderCredential.findMany.mockResolvedValue([
        makeCred({ apiKey: 'sk-abc1234567890xyz' }),
      ]);

      const result = await controller.listCredentials();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      // Primeiro 4 + **** + último 4
      expect(result.data[0].apiKey).toBe('sk-a****0xyz');
      // Original não deve aparecer
      expect(result.data[0].apiKey).not.toContain('1234567890');
    });

    it('ordena por provider ASC e priority ASC', async () => {
      prismaMock.aIProviderCredential.findMany.mockResolvedValue([]);

      await controller.listCredentials();

      expect(prismaMock.aIProviderCredential.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ provider: 'asc' }, { priority: 'asc' }],
        }),
      );
    });

    it('retorna lista vazia quando não há credenciais', async () => {
      prismaMock.aIProviderCredential.findMany.mockResolvedValue([]);
      const result = await controller.listCredentials();
      expect(result.data).toEqual([]);
    });

    it('mascara chave curta (≤8 chars) como ****', async () => {
      prismaMock.aIProviderCredential.findMany.mockResolvedValue([
        makeCred({ apiKey: 'short' }),
      ]);
      const result = await controller.listCredentials();
      expect(result.data[0].apiKey).toBe('****');
    });

    it('mascara chave de exatamente 8 chars como ****', async () => {
      prismaMock.aIProviderCredential.findMany.mockResolvedValue([
        makeCred({ apiKey: '12345678' }),
      ]);
      const result = await controller.listCredentials();
      expect(result.data[0].apiKey).toBe('****');
    });
  });

  // ─── GET /admin/ai-credentials/status ────────────────────────────────────

  describe('getStatus', () => {
    it('retorna summary com contagens por provider', async () => {
      prismaMock.aIProviderCredential.findMany.mockResolvedValue([
        makeCred({ provider: 'openai', isActive: true, isExhausted: false }),
        makeCred({ id: 'c2', provider: 'openai', isActive: true, isExhausted: true }),
        makeCred({ id: 'c3', provider: 'openai', isActive: false, isExhausted: false }),
        makeCred({ id: 'c4', provider: 'groq', isActive: true, isExhausted: false }),
      ]);

      const result = await controller.getStatus();

      expect(result.success).toBe(true);
      const openai = result.data.find((d: any) => d.provider === 'openai');
      expect(openai).toBeDefined();
      expect(openai!.total).toBe(3);
      expect(openai!.active).toBe(1);    // ativo E não esgotado
      expect(openai!.inactive).toBe(1);
      expect(openai!.exhausted).toBe(1);

      const groq = result.data.find((d: any) => d.provider === 'groq');
      expect(groq!.total).toBe(1);
      expect(groq!.active).toBe(1);
    });

    it('inclui os 4 providers mesmo sem credenciais', async () => {
      prismaMock.aIProviderCredential.findMany.mockResolvedValue([]);
      const result = await controller.getStatus();
      const providers = result.data.map((d: any) => d.provider);
      expect(providers).toEqual(expect.arrayContaining(['openai', 'google_gemini', 'groq', 'deepseek']));
      expect(result.data).toHaveLength(4);
    });

    it('provider sem credenciais retorna zeros', async () => {
      prismaMock.aIProviderCredential.findMany.mockResolvedValue([]);
      const result = await controller.getStatus();
      const deepseek = result.data.find((d: any) => d.provider === 'deepseek');
      expect(deepseek!.total).toBe(0);
      expect(deepseek!.active).toBe(0);
      expect(deepseek!.exhausted).toBe(0);
    });
  });

  // ─── POST /admin/ai-credentials ──────────────────────────────────────────

  describe('createCredential', () => {
    const dto = {
      provider: 'openai',
      label: 'openai-key-1',
      apiKey: 'sk-new-key-123',
      priority: 1,
      isActive: true,
    };

    it('cria credencial e retorna com apiKey mascarada', async () => {
      const created = makeCred({ ...dto, id: 'new-id' });
      prismaMock.aIProviderCredential.create.mockResolvedValue(created);

      const result = await controller.createCredential(dto);

      expect(result.success).toBe(true);
      expect(result.message).toContain('criada');
      expect(result.data.id).toBe('new-id');
      expect(result.data.apiKey).not.toBe('sk-new-key-123'); // mascarada
    });

    it('usa priority=100 e isActive=true quando não informados', async () => {
      const dtoMin = { provider: 'groq', label: 'groq-key', apiKey: 'gsk_test' };
      prismaMock.aIProviderCredential.create.mockResolvedValue(
        makeCred({ ...dtoMin, priority: 100, isActive: true }),
      );

      await controller.createCredential(dtoMin as any);

      expect(prismaMock.aIProviderCredential.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ priority: 100, isActive: true }),
      });
    });

    it('propaga erro do Prisma (ex: violação de unique)', async () => {
      prismaMock.aIProviderCredential.create.mockRejectedValue(
        new Error('Unique constraint failed'),
      );

      await expect(controller.createCredential(dto)).rejects.toThrow('Unique constraint failed');
    });
  });

  // ─── PUT /admin/ai-credentials/:id ───────────────────────────────────────

  describe('updateCredential', () => {
    it('atualiza label e priority', async () => {
      const cred = makeCred();
      const updated = makeCred({ label: 'renamed', priority: 5 });
      prismaMock.aIProviderCredential.findUnique.mockResolvedValue(cred);
      prismaMock.aIProviderCredential.update.mockResolvedValue(updated);

      const result = await controller.updateCredential('cred-1', { label: 'renamed', priority: 5 });

      expect(result.success).toBe(true);
      expect(result.data.label).toBe('renamed');
    });

    it('não sobrescreve apiKey quando omitida', async () => {
      prismaMock.aIProviderCredential.findUnique.mockResolvedValue(makeCred());
      prismaMock.aIProviderCredential.update.mockResolvedValue(makeCred());

      await controller.updateCredential('cred-1', { label: 'new-label' });

      const updateCall = prismaMock.aIProviderCredential.update.mock.calls[0][0];
      expect(updateCall.data.apiKey).toBeUndefined();
    });

    it('sobrescreve apiKey quando enviada', async () => {
      prismaMock.aIProviderCredential.findUnique.mockResolvedValue(makeCred());
      prismaMock.aIProviderCredential.update.mockResolvedValue(makeCred({ apiKey: 'sk-new' }));

      await controller.updateCredential('cred-1', { apiKey: 'sk-new' });

      const updateCall = prismaMock.aIProviderCredential.update.mock.calls[0][0];
      expect(updateCall.data.apiKey).toBe('sk-new');
    });

    it('reativar credencial limpa flags de esgotamento', async () => {
      const exhausted = makeCred({ isActive: false, isExhausted: true, exhaustedAt: NOW, exhaustedReason: 'quota' });
      prismaMock.aIProviderCredential.findUnique.mockResolvedValue(exhausted);
      prismaMock.aIProviderCredential.update.mockResolvedValue(
        makeCred({ isActive: true, isExhausted: false }),
      );

      await controller.updateCredential('cred-1', { isActive: true });

      const updateCall = prismaMock.aIProviderCredential.update.mock.calls[0][0];
      expect(updateCall.data.isActive).toBe(true);
      expect(updateCall.data.isExhausted).toBe(false);
      expect(updateCall.data.exhaustedAt).toBeNull();
      expect(updateCall.data.exhaustedReason).toBeNull();
    });

    it('desativar credencial NÃO limpa flags de esgotamento', async () => {
      prismaMock.aIProviderCredential.findUnique.mockResolvedValue(makeCred());
      prismaMock.aIProviderCredential.update.mockResolvedValue(makeCred({ isActive: false }));

      await controller.updateCredential('cred-1', { isActive: false });

      const updateCall = prismaMock.aIProviderCredential.update.mock.calls[0][0];
      expect(updateCall.data.isExhausted).toBeUndefined();
    });

    it('lança NotFoundException quando credencial não existe', async () => {
      prismaMock.aIProviderCredential.findUnique.mockResolvedValue(null);

      await expect(
        controller.updateCredential('nonexistent', { label: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── DELETE /admin/ai-credentials/:id ────────────────────────────────────

  describe('deleteCredential', () => {
    it('remove credencial inativa com sucesso', async () => {
      const inactive = makeCred({ isActive: false });
      prismaMock.aIProviderCredential.findUnique.mockResolvedValue(inactive);
      prismaMock.aIProviderCredential.count.mockResolvedValue(1); // 1 ativa restante
      prismaMock.aIProviderCredential.delete.mockResolvedValue(inactive);

      const result = await controller.deleteCredential('cred-1');

      expect(result.success).toBe(true);
      expect(result.message).toContain('removida');
      expect(prismaMock.aIProviderCredential.delete).toHaveBeenCalledWith({ where: { id: 'cred-1' } });
    });

    it('remove credencial ativa quando há outra ativa no mesmo provider', async () => {
      prismaMock.aIProviderCredential.findUnique.mockResolvedValue(makeCred({ isActive: true }));
      prismaMock.aIProviderCredential.count.mockResolvedValue(2); // ainda tem outra ativa
      prismaMock.aIProviderCredential.delete.mockResolvedValue({});

      const result = await controller.deleteCredential('cred-1');

      expect(result.success).toBe(true);
      expect(prismaMock.aIProviderCredential.delete).toHaveBeenCalled();
    });

    it('bloqueia remoção da última credencial ativa do provider', async () => {
      prismaMock.aIProviderCredential.findUnique.mockResolvedValue(makeCred({ isActive: true }));
      prismaMock.aIProviderCredential.count.mockResolvedValue(1); // só esta está ativa

      const result = await controller.deleteCredential('cred-1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('última credencial ativa');
      expect(prismaMock.aIProviderCredential.delete).not.toHaveBeenCalled();
    });

    it('lança NotFoundException quando credencial não existe', async () => {
      prismaMock.aIProviderCredential.findUnique.mockResolvedValue(null);

      await expect(controller.deleteCredential('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── POST /admin/ai-credentials/reset-exhausted ──────────────────────────

  describe('resetExhausted', () => {
    it('reseta N credenciais esgotadas e retorna contagem', async () => {
      prismaMock.aIProviderCredential.updateMany.mockResolvedValue({ count: 4 });

      const result = await controller.resetExhausted();

      expect(result.success).toBe(true);
      expect(result.count).toBe(4);
      expect(result.message).toContain('4');
    });

    it('retorna 0 quando nenhuma estava esgotada', async () => {
      prismaMock.aIProviderCredential.updateMany.mockResolvedValue({ count: 0 });

      const result = await controller.resetExhausted();

      expect(result.count).toBe(0);
    });

    it('limpa isExhausted, exhaustedAt e exhaustedReason', async () => {
      prismaMock.aIProviderCredential.updateMany.mockResolvedValue({ count: 1 });

      await controller.resetExhausted();

      expect(prismaMock.aIProviderCredential.updateMany).toHaveBeenCalledWith({
        where: { isExhausted: true },
        data: { isExhausted: false, exhaustedAt: null, exhaustedReason: null },
      });
    });
  });
});

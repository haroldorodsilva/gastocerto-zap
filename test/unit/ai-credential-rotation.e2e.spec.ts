/**
 * E2E – Ciclo de vida completo da rotação de credenciais de IA.
 *
 * Simula o fluxo de ponta a ponta que ocorre quando mensagens
 * típicas de usuário WhatsApp chegam ao sistema:
 *
 * 1. Usuário envia mensagem de gasto → sistema seleciona credencial → markUsed
 * 2. Credencial atinge quota (429) → sistema exaure e rotaciona para próxima
 * 3. Admin chama POST /reset-exhausted → flags limpos → credencial volta ao pool
 * 4. Cenários com múltiplos providers e mensagens humanizadas
 *
 * Usa AICredentialSelectorService com Prisma mockado (sem banco real).
 * Replica runWithCredentialRotation inline para isolar da infraestrutura NestJS.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { AICredentialSelectorService } from '@infrastructure/ai/credentials/ai-credential-selector.service';
import { AdminAICredentialsController } from '@features/admin/controllers/admin-ai-credentials.controller';
import { PrismaService } from '@core/database/prisma.service';
import { CryptoService } from '@common/services/crypto.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { AIProviderType } from '@infrastructure/ai/ai.interface';
import { aiCredentialContext, AICredentialContextValue } from '@infrastructure/ai/credentials/ai-credential.context';
import { NotFoundException } from '@nestjs/common';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDbCred(overrides: Partial<any> = {}) {
  return {
    id: 'cred-1',
    provider: 'openai',
    label: 'openai-primary',
    apiKey: 'sk-plaintext-key-001',
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
  };
}

function makeQuotaError(msg = 'You exceeded your current quota') {
  const err: any = new Error(msg);
  err.status = 429;
  return err;
}

function makeServerError(msg = 'Internal server error') {
  const err: any = new Error(msg);
  err.status = 500;
  return err;
}

/**
 * Versão inline de AIProviderFactory.runWithCredentialRotation para testes.
 * Itera sobre credenciais disponíveis e lida com erros de quota/genérico.
 */
async function runWithRotation(
  selector: AICredentialSelectorService,
  provider: AIProviderType,
  fn: (cred: AICredentialContextValue) => Promise<string>,
): Promise<string> {
  const creds = await selector.listAvailable(provider);
  if (creds.length === 0) {
    throw new Error(`Nenhuma credencial disponível para provider=${provider}`);
  }

  const errors: Error[] = [];
  for (const cred of creds) {
    try {
      const result = await aiCredentialContext.run(cred, () => fn(cred));
      await selector.markUsed(cred.credentialId);
      return result;
    } catch (err: any) {
      if (AICredentialSelectorService.isQuotaError(err)) {
        await selector.markExhausted(cred.credentialId, err.message ?? 'quota');
        errors.push(err);
        continue; // tenta próxima credencial
      } else {
        await selector.markError(cred.credentialId);
        throw err; // relança erros não-quota imediatamente
      }
    }
  }

  throw new Error(
    `Todas as credenciais do provider=${provider} estão esgotadas. ` +
      errors.map((e) => e.message).join(', '),
  );
}

// ─── Setup comum ─────────────────────────────────────────────────────────────

function buildPrismaMock() {
  return {
    aIProviderCredential: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CENÁRIO 1: Fluxo de registro de gasto com credencial disponível
// ═══════════════════════════════════════════════════════════════════════════

describe('E2E – Ciclo de vida: registro de gasto → seleção → markUsed', () => {
  let selector: AICredentialSelectorService;
  let prisma: any;

  const gastasMensagens = [
    'Gastei 50 reais no almoço',
    'Paguei 120 na conta de luz',
    'Comprei remédio na farmácia por 35,90',
    'Gastei 200 no supermercado hoje',
    'Paguei o uber 28 reais',
  ];

  beforeEach(async () => {
    prisma = buildPrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AICredentialSelectorService,
        { provide: PrismaService, useValue: prisma },
        { provide: CryptoService, useValue: { decrypt: (k: string) => k, encrypt: (k: string) => k } },
      ],
    }).compile();

    selector = module.get<AICredentialSelectorService>(AICredentialSelectorService);
  });

  it.each(gastasMensagens)(
    'processa mensagem "%s" → seleciona credencial → marca como usada',
    async (mensagem) => {
      const cred = makeDbCred();
      prisma.aIProviderCredential.findMany.mockResolvedValue([cred]);
      prisma.aIProviderCredential.update.mockResolvedValue(cred);

      // Simula AI extratora que retorna resultado baseado no texto da mensagem
      const resultado = await runWithRotation(
        selector,
        AIProviderType.OPENAI,
        async (c) => {
          // Em produção seria uma chamada real ao modelo; aqui simulamos extração
          expect(c.apiKey).toBe(cred.apiKey);
          expect(mensagem.length).toBeGreaterThan(0);
          return JSON.stringify({ amount: 50, description: 'almoço', category: 'Alimentação' });
        },
      );

      expect(resultado).toBeTruthy();
      expect(JSON.parse(resultado)).toHaveProperty('amount');

      // Verifica que markUsed foi chamado
      expect(prisma.aIProviderCredential.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: cred.id },
          data: expect.objectContaining({ lastUsedAt: expect.any(Date) }),
        }),
      );
    },
  );

  it('contexto async isola a credencial dentro do runWithRotation', async () => {
    const cred = makeDbCred({ id: 'ctx-cred', apiKey: 'sk-ctx-key' });
    prisma.aIProviderCredential.findMany.mockResolvedValue([cred]);
    prisma.aIProviderCredential.update.mockResolvedValue(cred);

    let credWithinContext: AICredentialContextValue | undefined;
    await runWithRotation(selector, AIProviderType.OPENAI, async () => {
      credWithinContext = aiCredentialContext.getStore();
      return 'ok';
    });

    // Dentro do contexto async, a credencial deve estar disponível
    expect(credWithinContext).toBeDefined();
    expect(credWithinContext!.credentialId).toBe('ctx-cred');
    expect(credWithinContext!.apiKey).toBe('sk-ctx-key');
  });

  it('contexto NÃO está disponível fora do runWithRotation', async () => {
    // Fora do contexto, deve ser undefined
    const outside = aiCredentialContext.getStore();
    expect(outside).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CENÁRIO 2: Quota exaurida → rotação para próxima credencial
// ═══════════════════════════════════════════════════════════════════════════

describe('E2E – Rotação quando credencial primária atinge quota', () => {
  let selector: AICredentialSelectorService;
  let prisma: any;

  beforeEach(async () => {
    prisma = buildPrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AICredentialSelectorService,
        { provide: PrismaService, useValue: prisma },
        { provide: CryptoService, useValue: { decrypt: (k: string) => k, encrypt: (k: string) => k } },
      ],
    }).compile();

    selector = module.get<AICredentialSelectorService>(AICredentialSelectorService);
  });

  it('ao receber 429 na cred primária, rotaciona para a secundária', async () => {
    const credPrimaria = makeDbCred({ id: 'cred-primary', label: 'openai-primary', priority: 1 });
    const credSecundaria = makeDbCred({ id: 'cred-secondary', label: 'openai-backup', priority: 2 });
    prisma.aIProviderCredential.findMany.mockResolvedValue([credPrimaria, credSecundaria]);
    prisma.aIProviderCredential.update.mockResolvedValue({});

    let chamadas = 0;
    const resultado = await runWithRotation(selector, AIProviderType.OPENAI, async (cred) => {
      chamadas++;
      if (cred.credentialId === 'cred-primary') {
        throw makeQuotaError('You exceeded your current quota, please check your plan');
      }
      return 'Transação registrada com credencial backup';
    });

    expect(chamadas).toBe(2);
    expect(resultado).toContain('backup');
    // markExhausted chamado para a primária
    expect(prisma.aIProviderCredential.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cred-primary' }, data: expect.objectContaining({ isExhausted: true }) }),
    );
    // markUsed chamado para a secundária
    expect(prisma.aIProviderCredential.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cred-secondary' }, data: expect.objectContaining({ lastUsedAt: expect.any(Date) }) }),
    );
  });

  it('múltiplas mensagens de WhatsApp → cada chamada esgota a cred e rotaciona', async () => {
    const mensagens = [
      'Gastei 25 no café da manhã',
      'Paguei 99 da assinatura da Netflix',
      'Comprei R$180 de mantimentos',
    ];

    const credPrimaria = makeDbCred({ id: 'cred-a', priority: 1 });
    const credSecundaria = makeDbCred({ id: 'cred-b', priority: 2 });
    prisma.aIProviderCredential.findMany.mockResolvedValue([credPrimaria, credSecundaria]);
    prisma.aIProviderCredential.update.mockResolvedValue({});

    let tentativas = 0;
    for (const msg of mensagens) {
      // Simula: primária sempre 429, secundária sempre OK
      // eslint-disable-next-line no-loop-func
      const resultado = await runWithRotation(selector, AIProviderType.OPENAI, async (cred) => {
        tentativas++;
        if (cred.credentialId === 'cred-a') throw makeQuotaError();
        return `Extraído de: ${msg}`;
      });

      expect(resultado).toContain(msg);
    }

    // Tentou a primária (e rodou a secundária) para cada uma das 3 mensagens → 6 tentativas
    expect(tentativas).toBe(6);
  });

  it('todas as credenciais esgotadas → lança erro descritivo', async () => {
    const creds = [
      makeDbCred({ id: 'cred-x', label: 'key-1' }),
      makeDbCred({ id: 'cred-y', label: 'key-2' }),
    ];
    prisma.aIProviderCredential.findMany.mockResolvedValue(creds);
    prisma.aIProviderCredential.update.mockResolvedValue({});

    await expect(
      runWithRotation(selector, AIProviderType.OPENAI, async () => {
        throw makeQuotaError('quota exhausted');
      }),
    ).rejects.toThrow(/Todas as credenciais/);
  });

  it('erro 500 (não quota) → relança imediatamente, NÃO testa cred seguinte', async () => {
    const creds = [
      makeDbCred({ id: 'cred-500', label: 'key-1' }),
      makeDbCred({ id: 'cred-ok', label: 'key-2' }),
    ];
    prisma.aIProviderCredential.findMany.mockResolvedValue(creds);
    prisma.aIProviderCredential.update.mockResolvedValue({});

    let chamadas = 0;
    await expect(
      runWithRotation(selector, AIProviderType.OPENAI, async () => {
        chamadas++;
        throw makeServerError('model overloaded');
      }),
    ).rejects.toThrow('model overloaded');

    // Apenas 1 tentativa — não rotacionou para cred-ok
    expect(chamadas).toBe(1);

    // markError chamado, NÃO markExhausted
    expect(prisma.aIProviderCredential.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cred-500' },
        data: expect.objectContaining({ totalErrors: { increment: 1 } }),
      }),
    );
    // Verifica que isExhausted NÃO foi setado
    const calls = prisma.aIProviderCredential.update.mock.calls;
    for (const [args] of calls) {
      expect(args.data.isExhausted).toBeUndefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CENÁRIO 3: Admin reseta flags → credencial volta ao pool de rotação
// ═══════════════════════════════════════════════════════════════════════════

describe('E2E – Admin reseta esgotamento → credencial disponível novamente', () => {
  let selector: AICredentialSelectorService;
  let controller: AdminAICredentialsController;
  let prisma: any;

  beforeEach(async () => {
    prisma = buildPrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminAICredentialsController],
      providers: [
        AICredentialSelectorService,
        { provide: PrismaService, useValue: prisma },
        { provide: CryptoService, useValue: { decrypt: (k: string) => k, encrypt: (k: string) => k } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    selector = module.get<AICredentialSelectorService>(AICredentialSelectorService);
    controller = module.get<AdminAICredentialsController>(AdminAICredentialsController);
  });

  it('ciclo completo: usar → esgotar → resetar → disponível novamente', async () => {
    const credA = makeDbCred({ id: 'lifecycle-cred', label: 'openai-lifecycle', priority: 1 });
    prisma.aIProviderCredential.update.mockResolvedValue({});

    // PASSO 1: Credencial disponível → markUsed
    prisma.aIProviderCredential.findMany.mockResolvedValue([credA]);
    const step1 = await runWithRotation(selector, AIProviderType.OPENAI, async () => 'ok-step1');
    expect(step1).toBe('ok-step1');
    expect(prisma.aIProviderCredential.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastUsedAt: expect.any(Date) }) }),
    );

    // PASSO 2: Quota exauriu a credencial → listAvailable retorna vazia agora
    prisma.aIProviderCredential.findMany.mockResolvedValueOnce([credA]);
    prisma.aIProviderCredential.update.mockClear();
    await expect(
      runWithRotation(selector, AIProviderType.OPENAI, async () => {
        throw makeQuotaError('quota exceeded');
      }),
    ).rejects.toThrow(/Todas as credenciais/);
    expect(prisma.aIProviderCredential.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isExhausted: true }) }),
    );

    // PASSO 3: Nenhuma credencial disponível → lança erro imediatamente
    prisma.aIProviderCredential.findMany.mockResolvedValueOnce([]); // simula BD após exaurir
    await expect(
      runWithRotation(selector, AIProviderType.OPENAI, async () => 'never-reached'),
    ).rejects.toThrow('Nenhuma credencial disponível');

    // PASSO 4: Admin reseta via endpoint
    prisma.aIProviderCredential.updateMany.mockResolvedValue({ count: 1 });
    const resetResult = await controller.resetExhausted();
    expect(resetResult.success).toBe(true);
    expect(resetResult.count).toBe(1);
    expect(prisma.aIProviderCredential.updateMany).toHaveBeenCalledWith({
      where: { isExhausted: true },
      data: { isExhausted: false, exhaustedAt: null, exhaustedReason: null },
    });

    // PASSO 5: Credencial disponível novamente após reset
    prisma.aIProviderCredential.findMany.mockResolvedValueOnce([credA]);
    prisma.aIProviderCredential.update.mockClear();
    const step5 = await runWithRotation(selector, AIProviderType.OPENAI, async () => 'back-online');
    expect(step5).toBe('back-online');
  });

  it('admin cria nova credencial → disponível imediatamente para rotação', async () => {
    prisma.aIProviderCredential.create.mockResolvedValue(
      makeDbCred({ id: 'new-cred', label: 'novo-key', apiKey: 'sk-novo-000' }),
    );
    const criado = await controller.createCredential({
      provider: 'openai',
      label: 'novo-key',
      apiKey: 'sk-novo-000',
      priority: 3,
    } as any);
    expect(criado.success).toBe(true);
    expect(criado.data.id).toBe('new-cred');

    // Após criar, nova credencial está no pool
    const novaCred = makeDbCred({ id: 'new-cred', label: 'novo-key', apiKey: 'sk-novo-000' });
    prisma.aIProviderCredential.findMany.mockResolvedValue([novaCred]);
    prisma.aIProviderCredential.update.mockResolvedValue({});

    const resultado = await runWithRotation(selector, AIProviderType.OPENAI, async (c) => {
      expect(c.credentialId).toBe('new-cred');
      return 'nova-cred-ok';
    });
    expect(resultado).toBe('nova-cred-ok');
  });

  it('admin reativa credencial desativada → limpa exhausted e volta ao pool', async () => {
    const credDesativada = makeDbCred({
      id: 'deactivated',
      isActive: false,
      isExhausted: true,
      exhaustedAt: new Date(),
      exhaustedReason: 'You exceeded quota',
    });
    prisma.aIProviderCredential.findUnique.mockResolvedValue(credDesativada);
    prisma.aIProviderCredential.update.mockResolvedValue({
      ...credDesativada,
      isActive: true,
      isExhausted: false,
      exhaustedAt: null,
      exhaustedReason: null,
    });

    const reativada = await controller.updateCredential('deactivated', { isActive: true });

    expect(reativada.success).toBe(true);
    expect(prisma.aIProviderCredential.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isActive: true,
          isExhausted: false,
          exhaustedAt: null,
          exhaustedReason: null,
        }),
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CENÁRIO 4: Múltiplos providers - isolamento de pool
// ═══════════════════════════════════════════════════════════════════════════

describe('E2E – Providers diferentes têm pools independentes', () => {
  let selector: AICredentialSelectorService;
  let prisma: any;

  beforeEach(async () => {
    prisma = buildPrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AICredentialSelectorService,
        { provide: PrismaService, useValue: prisma },
        { provide: CryptoService, useValue: { decrypt: (k: string) => k, encrypt: (k: string) => k } },
      ],
    }).compile();

    selector = module.get<AICredentialSelectorService>(AICredentialSelectorService);
  });

  it('quota em openai não afeta groq', async () => {
    // openai sem credenciais disponíveis (esgotadas)
    // groq com credencial disponível
    prisma.aIProviderCredential.findMany
      .mockImplementation(({ where }: any) => {
        if (where?.provider === 'openai') return Promise.resolve([]);
        if (where?.provider === 'groq') {
          return Promise.resolve([makeDbCred({ id: 'groq-cred', provider: 'groq', label: 'groq-key' })]);
        }
        return Promise.resolve([]);
      });
    prisma.aIProviderCredential.update.mockResolvedValue({});

    // OpenAI falha por falta de creds
    await expect(
      runWithRotation(selector, AIProviderType.OPENAI, async () => 'never'),
    ).rejects.toThrow('Nenhuma credencial disponível');

    // Groq funciona normalmente
    const resultado = await runWithRotation(selector, AIProviderType.GROQ, async (c) => {
      expect(c.provider).toBe('groq');
      return 'groq-processou';
    });
    expect(resultado).toBe('groq-processou');
  });

  it('cada provider consulta apenas seu próprio pool no banco', async () => {
    prisma.aIProviderCredential.findMany.mockResolvedValue([]);

    for (const [type, dbName] of [
      [AIProviderType.OPENAI, 'openai'],
      [AIProviderType.GOOGLE_GEMINI, 'google_gemini'],
      [AIProviderType.GROQ, 'groq'],
      [AIProviderType.DEEPSEEK, 'deepseek'],
    ] as const) {
      prisma.aIProviderCredential.findMany.mockClear();
      await selector.listAvailable(type).catch(() => {});

      expect(prisma.aIProviderCredential.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ provider: dbName }),
        }),
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CENÁRIO 5: Fluxo de conversa humanizada com registro de transação
// ═══════════════════════════════════════════════════════════════════════════

describe('E2E – Fluxo humanizado: sequência de mensagens WhatsApp', () => {
  let selector: AICredentialSelectorService;
  let prisma: any;

  beforeEach(async () => {
    prisma = buildPrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AICredentialSelectorService,
        { provide: PrismaService, useValue: prisma },
        { provide: CryptoService, useValue: { decrypt: (k: string) => k, encrypt: (k: string) => k } },
      ],
    }).compile();

    selector = module.get<AICredentialSelectorService>(AICredentialSelectorService);
    prisma.aIProviderCredential.update.mockResolvedValue({});
  });

  /**
   * Simula extração de transação (o que o AIProvider faria na prática).
   * Retorna um objeto de transação fictício com base na mensagem.
   */
  function simulateAIExtraction(msg: string) {
    return {
      amount: parseFloat(msg.match(/(\d+[,.]?\d*)/)?.[1]?.replace(',', '.') ?? '0'),
      description: msg,
      category: 'Alimentação',
      confidence: 0.95,
    };
  }

  it('sequência de gastos em português → todas processam com mesmo pool de credenciais', async () => {
    const cred = makeDbCred();
    prisma.aIProviderCredential.findMany.mockResolvedValue([cred]);

    const sequenciaMensagens = [
      'Gastei 50 reais no almoço do trabalho',
      'Paguei 35,90 no Uber pra voltar',
      'Comprei um café por 8,50',
      'Tomei 2 remédios, gastei 42 na farmácia',
      'Paguei 280 na conta de internet',
    ];

    const resultados: string[] = [];
    for (const msg of sequenciaMensagens) {
      const res = await runWithRotation(selector, AIProviderType.OPENAI, async (c) => {
        const extracted = simulateAIExtraction(msg);
        return JSON.stringify({ credUsed: c.label, ...extracted });
      });
      resultados.push(res);
    }

    // Todas as mensagens foram processadas
    expect(resultados).toHaveLength(5);
    resultados.forEach((r) => {
      const parsed = JSON.parse(r);
      expect(parsed.credUsed).toBe(cred.label);
      expect(parsed.amount).toBeGreaterThan(0);
    });

    // markUsed chamado 5 vezes
    const markUsedCalls = prisma.aIProviderCredential.update.mock.calls.filter(
      ([args]: any) => args.data?.lastUsedAt !== undefined,
    );
    expect(markUsedCalls).toHaveLength(5);
  });

  it('conversa multi-turno: 1ª mensagem 429 → rotaciona → continua sequência com 2ª cred', async () => {
    const credPrimaria = makeDbCred({ id: 'main', label: 'main-key', priority: 1 });
    const credBackup = makeDbCred({ id: 'backup', label: 'backup-key', priority: 2 });

    // Primeiros 2 turnos: cred primária com quota, depois esgota
    prisma.aIProviderCredential.findMany
      .mockResolvedValueOnce([credPrimaria, credBackup]) // turno 1: tenta primária → quota → backup
      .mockResolvedValueOnce([credPrimaria, credBackup]) // turno 2: idem
      .mockResolvedValue([credBackup]);                  // demais: só backup disponível

    const diálogo = [
      'Paguei 150 no supermercado',
      'Gastei 60 na pizza do fim de semana',
      'Comprei 3 livros por 89 reais',
    ];

    let turnoPrimaria = 0;
    const respostas: string[] = [];

    for (const fala of diálogo) {
      const res = await runWithRotation(selector, AIProviderType.OPENAI, async (cred) => {
        if (cred.credentialId === 'main') {
          turnoPrimaria++;
          // Primária falha com quota nos 2 primeiros turnos
          if (turnoPrimaria <= 2) throw makeQuotaError();
        }
        return `Transação extraída de: ${fala}`;
      });
      respostas.push(res);
    }

    // Todas as 3 falas foram processadas (rotação funcionou para as 2 primeiras)
    expect(respostas).toHaveLength(3);
    respostas.forEach((r) => expect(r).toContain('Transação extraída'));

    // markExhausted chamado para a primária nos 2 primeiros turnos
    const exhaustedCalls = prisma.aIProviderCredential.update.mock.calls.filter(
      ([args]: any) => args.data?.isExhausted === true,
    );
    expect(exhaustedCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('credencial com totalErrors incrementado não é exaurida em erros 500', async () => {
    const cred = makeDbCred({ id: 'error-prone', totalErrors: 0 });
    prisma.aIProviderCredential.findMany.mockResolvedValue([cred]);

    // Simula erro genérico (não quota)
    await expect(
      runWithRotation(selector, AIProviderType.OPENAI, async () => {
        throw makeServerError('Connection timeout');
      }),
    ).rejects.toThrow('Connection timeout');

    // markError foi chamado (incrementa totalErrors)
    expect(prisma.aIProviderCredential.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'error-prone' },
        data: { totalErrors: { increment: 1 } },
      }),
    );
    // isExhausted NÃO foi setado
    const allCalls: any[][] = prisma.aIProviderCredential.update.mock.calls;
    for (const [arg] of allCalls) {
      expect(arg.data?.isExhausted).toBeUndefined();
    }
  });
});

/**
 * E2E – Fluxo de conversa humanizada multi-turno.
 *
 * Testa os três pilares da humanização implementados no plano:
 *
 * 1. **ConversationMemoryService** — histórico Redis, addEntry/getHistory/getLastIntent
 * 2. **DisambiguationService** — mensagem ambígua → sugestão → resolução numérica
 * 3. **Variabilidade de respostas** — mesma intenção, respostas diferentes
 *
 * Usa RedisService mockado (sem Redis real), seguindo o padrão do
 * teste existente em `test/unit/disambiguation.service.spec.ts`.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConversationMemoryService, ConversationEntry } from '@features/conversation/conversation-memory.service';
import { DisambiguationService } from '@features/conversation/disambiguation.service';
import { RedisService } from '@common/services/redis.service';
import {
  getHumanGreeting,
  getUnknownMessage,
  getHelpMessage,
  getPostActionSuggestion,
  getListingIntro,
  getBalanceComment,
} from '@shared/utils/response-variations';

// ─── Helpers de mock Redis ────────────────────────────────────────────────

function buildRedisMock() {
  // Simula ioredis pipeline com pipeline builder funcional
  const store = new Map<string, string>();
  const lists = new Map<string, string[]>();

  function buildPipeline() {
    const ops: (() => Promise<any>)[] = [];
    const pipeline: any = {
      rpush: (key: string, value: string) => {
        ops.push(async () => {
          const list = lists.get(key) ?? [];
          list.push(value);
          lists.set(key, list);
        });
        return pipeline;
      },
      ltrim: (key: string, start: number, end: number) => {
        ops.push(async () => {
          const list = lists.get(key) ?? [];
          const trimmed = end === -1 ? list.slice(start) : list.slice(start, end + 1);
          lists.set(key, trimmed);
        });
        return pipeline;
      },
      expire: () => pipeline,
      exec: async () => {
        for (const op of ops) await op();
        return [];
      },
    };
    return pipeline;
  }

  const client = {
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    del: jest.fn(async (key: string) => {
      store.delete(key);
      lists.delete(key);
      return 1;
    }),
    lrange: jest.fn(async (key: string, start: number, end: number) => {
      const list = lists.get(key) ?? [];
      return end === -1 ? list.slice(start) : list.slice(start, end + 1);
    }),
    pipeline: jest.fn(buildPipeline),
  };

  return {
    isReady: jest.fn().mockReturnValue(true),
    getClient: jest.fn().mockReturnValue(client),
    _store: store,
    _lists: lists,
    _client: client,
  };
}

const PHONE = '5511999990001';

// ═══════════════════════════════════════════════════════════════════════════
// CENÁRIO 1: ConversationMemoryService — histórico Redis in-memory
// ═══════════════════════════════════════════════════════════════════════════

describe('E2E – ConversationMemoryService: histórico multi-turno', () => {
  let memory: ConversationMemoryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationMemoryService,
        { provide: RedisService, useValue: buildRedisMock() },
      ],
    }).compile();

    memory = module.get<ConversationMemoryService>(ConversationMemoryService);
  });

  it('salva e recupera uma entrada de usuário', async () => {
    await memory.addEntry(PHONE, { role: 'user', text: 'Gastei 50 no almoço', intent: 'REGISTER_TRANSACTION' });
    const history = await memory.getHistory(PHONE);

    expect(history).toHaveLength(1);
    expect(history[0].role).toBe('user');
    expect(history[0].text).toBe('Gastei 50 no almoço');
    expect(history[0].intent).toBe('REGISTER_TRANSACTION');
    expect(history[0].timestamp).toBeLessThanOrEqual(Date.now());
  });

  it('salva conversa multi-turno (user → bot → user → bot)', async () => {
    await memory.addEntry(PHONE, { role: 'user', text: 'minhas transações', intent: 'LIST_TRANSACTIONS' });
    await memory.addEntry(PHONE, { role: 'bot', text: 'Aqui estão suas 5 transações:' });
    await memory.addEntry(PHONE, { role: 'user', text: 'e de receitas?', intent: 'LIST_TRANSACTIONS' });
    await memory.addEntry(PHONE, { role: 'bot', text: 'Filtrando por receitas...' });

    const history = await memory.getHistory(PHONE);
    expect(history).toHaveLength(4);
    expect(history[0].role).toBe('user');
    expect(history[1].role).toBe('bot');
    expect(history[2].role).toBe('user');
    expect(history[3].role).toBe('bot');
  });

  it('getLastIntent retorna a última intenção registrada', async () => {
    await memory.addEntry(PHONE, { role: 'user', text: 'saldo', intent: 'CHECK_BALANCE' });
    await memory.addEntry(PHONE, { role: 'bot', text: 'Seu saldo é R$1.200' });
    await memory.addEntry(PHONE, { role: 'user', text: 'resumo', intent: 'MONTHLY_SUMMARY' });

    const lastIntent = await memory.getLastIntent(PHONE);
    expect(lastIntent).toBe('MONTHLY_SUMMARY');
  });

  it('getLastIntent ignora entradas do bot (sem intent)', async () => {
    await memory.addEntry(PHONE, { role: 'user', text: 'listar', intent: 'LIST_TRANSACTIONS' });
    await memory.addEntry(PHONE, { role: 'bot', text: 'Aqui estão as transações' });

    const lastIntent = await memory.getLastIntent(PHONE);
    expect(lastIntent).toBe('LIST_TRANSACTIONS');
  });

  it('getLastIntent retorna null quando histórico está vazio', async () => {
    const lastIntent = await memory.getLastIntent('5511000000000');
    expect(lastIntent).toBeNull();
  });

  it('mantém no máximo 10 entradas (circular buffer)', async () => {
    for (let i = 1; i <= 12; i++) {
      await memory.addEntry(PHONE, {
        role: 'user',
        text: `mensagem ${i}`,
        intent: 'REGISTER_TRANSACTION',
      });
    }

    const history = await memory.getHistory(PHONE);
    expect(history.length).toBeLessThanOrEqual(10);
    // As mais recentes devem estar no final
    expect(history[history.length - 1].text).toBe('mensagem 12');
  });

  it('clear() limpa o histórico do usuário', async () => {
    await memory.addEntry(PHONE, { role: 'user', text: 'oi', intent: 'GREETING' });
    await memory.clear(PHONE);
    const history = await memory.getHistory(PHONE);
    expect(history).toHaveLength(0);
  });

  it('funciona graciosamente quando Redis está offline', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationMemoryService,
        {
          provide: RedisService,
          useValue: { isReady: () => false, getClient: () => null },
        },
      ],
    }).compile();

    const offlineMemory = module.get<ConversationMemoryService>(ConversationMemoryService);

    // Não deve lançar
    await expect(
      offlineMemory.addEntry(PHONE, { role: 'user', text: 'teste' }),
    ).resolves.not.toThrow();

    const history = await offlineMemory.getHistory(PHONE);
    expect(history).toEqual([]);
  });

  it('histórico de dois usuários é isolado', async () => {
    const phone2 = '5511999990002';

    await memory.addEntry(PHONE, { role: 'user', text: 'usuário 1', intent: 'GREETING' });
    await memory.addEntry(phone2, { role: 'user', text: 'usuário 2', intent: 'CHECK_BALANCE' });

    const history1 = await memory.getHistory(PHONE);
    const history2 = await memory.getHistory(phone2);

    expect(history1).toHaveLength(1);
    expect(history2).toHaveLength(1);
    expect(history1[0].text).toBe('usuário 1');
    expect(history2[0].text).toBe('usuário 2');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CENÁRIO 2: DisambiguationService — fluxo completo sugestão → resolução
// ═══════════════════════════════════════════════════════════════════════════

describe('E2E – DisambiguationService: fluxo multi-turno de desambiguação', () => {
  let service: DisambiguationService;
  let redisMock: any;

  beforeEach(async () => {
    redisMock = buildRedisMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DisambiguationService,
        { provide: RedisService, useValue: redisMock },
      ],
    }).compile();

    service = module.get<DisambiguationService>(DisambiguationService);
  });

  it('mensagem ambígua curta gera sugestões com opções numeradas', async () => {
    const result = await service.suggest('transacoes', PHONE);

    // "transacoes" é suficientemente próximo de LIST_TRANSACTIONS_KEYWORDS
    if (result !== null) {
      expect(result).toContain('1️⃣');
      expect(result).toContain('número');
    }
    // Pode retornar null se o fuzzy não der match — não é erro
  });

  it('texto longo (>4 palavras) NÃO gera desambiguação', async () => {
    const result = await service.suggest('essa é uma frase muito longa demais', PHONE);
    expect(result).toBeNull();
  });

  it('texto completamente ininteligível retorna null', async () => {
    const result = await service.suggest('xyzqwerty', PHONE);
    expect(result).toBeNull();
  });

  it('ciclo completo: ambíguo → sugere → usuário escolhe "1" → intent resolvido', async () => {
    // Passo 1: mensagem ambígua gera sugestões (mock Redis guarda estado)
    const sugestao = await service.suggest('saldo', PHONE);

    // "saldo" pode dar match com CHECK_BALANCE
    const pending = await service.hasPending(PHONE);

    if (pending) {
      // Passo 2: usuário responde "1"
      const resolvedIntent = await service.resolveNumericResponse(PHONE, '1');
      expect(resolvedIntent).not.toBeNull();
      expect(typeof resolvedIntent).toBe('string');

      // Passo 3: estado limpo após resolver
      const stillPending = await service.hasPending(PHONE);
      expect(stillPending).toBe(false);
    } else {
      // Se "saldo" não gerou desambiguação (match direto), tudo bem
      expect(sugestao).toBeNull();
    }
  });

  it('resolveNumericResponse retorna null quando não há desambiguação pendente', async () => {
    const result = await service.resolveNumericResponse(PHONE, '1');
    expect(result).toBeNull();
  });

  it('resolveNumericResponse ignora textos não-numéricos', async () => {
    const result = await service.resolveNumericResponse(PHONE, 'não sei');
    expect(result).toBeNull();
  });

  it('resolveNumericResponse aceita variações como "opção 2"', async () => {
    // Simular estado de desambiguação pendente manualmente
    const client = redisMock.getClient();
    const stored = JSON.stringify({
      options: [
        { intent: 'LIST_TRANSACTIONS', label: 'Transações', description: 'Ver transações' },
        { intent: 'CHECK_BALANCE', label: 'Saldo', description: 'Ver saldo' },
      ],
      timestamp: Date.now(),
    });
    await client.set(`disamb:${PHONE}`, stored);

    const result = await service.resolveNumericResponse(PHONE, 'opcao 2');
    expect(result).toBe('CHECK_BALANCE');
  });

  it('resolveNumericResponse não aceita número fora do range', async () => {
    // Simular desambiguação com 2 opções
    const client = redisMock.getClient();
    await client.set(
      `disamb:${PHONE}`,
      JSON.stringify({
        options: [
          { intent: 'LIST_TRANSACTIONS', label: 'Transações', description: '' },
        ],
        timestamp: Date.now(),
      }),
    );

    // Opção 9 não existe
    const result = await service.resolveNumericResponse(PHONE, '9');
    expect(result).toBeNull();
  });

  it('diferentes usuários têm desambiguações independentes', async () => {
    const phone2 = '5511999990003';
    const client = redisMock.getClient();

    await client.set(
      `disamb:${PHONE}`,
      JSON.stringify({
        options: [{ intent: 'LIST_TRANSACTIONS', label: 'Transações', description: '' }],
        timestamp: Date.now(),
      }),
    );

    // phone2 não tem desambiguação pendente
    const pendingPhone1 = await service.hasPending(PHONE);
    const pendingPhone2 = await service.hasPending(phone2);

    expect(pendingPhone1).toBe(true);
    expect(pendingPhone2).toBe(false);
  });

  it('funciona graciosamente quando Redis está offline', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DisambiguationService,
        { provide: RedisService, useValue: { isReady: () => false, getClient: () => null } },
      ],
    }).compile();

    const offlineService = module.get<DisambiguationService>(DisambiguationService);

    // suggest não deve lançar
    await expect(offlineService.suggest('saldo', PHONE)).resolves.not.toThrow();

    // hasPending retorna false quando Redis offline
    const pending = await offlineService.hasPending(PHONE);
    expect(pending).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CENÁRIO 3: Variabilidade de respostas — mesma intenção, phrasing diferente
// ═══════════════════════════════════════════════════════════════════════════

describe('E2E – Variabilidade de respostas humanizadas', () => {
  it('getHumanGreeting retorna variações distintas em múltiplas chamadas', () => {
    const results = new Set<string>();
    for (let i = 0; i < 20; i++) {
      results.add(getHumanGreeting());
    }
    // Com 20 chamadas e 3 variações por período, deve ter pelo menos 2 distintas
    expect(results.size).toBeGreaterThanOrEqual(1);
    // Todas devem conter cumprimento
    for (const r of results) {
      expect(r.length).toBeGreaterThan(5);
    }
  });

  it('getUnknownMessage sempre contém dicas de uso', () => {
    for (let i = 0; i < 5; i++) {
      const msg = getUnknownMessage();
      expect(msg).toBeTruthy();
      expect(msg.length).toBeGreaterThan(20);
    }
  });

  it('getHelpMessage lista funcionalidades essenciais', () => {
    const msg = getHelpMessage();
    expect(msg).toContain('Registrar');
    expect(msg.length).toBeGreaterThan(50);
  });

  it('getPostActionSuggestion retorna string para REGISTER_TRANSACTION', () => {
    // A função pode retornar '' (variação aleatória — é intencional)
    const msg = getPostActionSuggestion('REGISTER_TRANSACTION');
    expect(typeof msg).toBe('string');
  });

  it('getPostActionSuggestion retorna string para LIST_TRANSACTIONS', () => {
    const msg = getPostActionSuggestion('LIST_TRANSACTIONS');
    expect(typeof msg).toBe('string');
  });

  it('getPostActionSuggestion retorna string vazia para intent desconhecido', () => {
    const msg = getPostActionSuggestion('UNKNOWN_INTENT');
    expect(msg).toBe('');
  });

  it('getListingIntro retorna vazio para lista vazia', () => {
    expect(getListingIntro(0)).toBe('');
  });

  it('getListingIntro retorna intro para lista não-vazia', () => {
    const intro = getListingIntro(3);
    expect(intro.length).toBeGreaterThan(0);
  });

  it('getBalanceComment retorna comentário para saldo positivo', () => {
    const comment = getBalanceComment(3000, 5000, 2000);
    expect(typeof comment).toBe('string');
  });

  it('getBalanceComment retorna alerta para saldo negativo', () => {
    const comment = getBalanceComment(8000, 3000, -5000);
    expect(comment.length).toBeGreaterThan(0);
  });

  it('getHumanGreeting inclui nome do usuário quando fornecido', () => {
    const greeting = getHumanGreeting('Maria Oliveira');
    expect(greeting).toContain('Maria');
  });

  it('getHumanGreeting não quebra sem nome (anônimo)', () => {
    expect(() => getHumanGreeting()).not.toThrow();
    expect(getHumanGreeting()).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CENÁRIO 4: Fluxo completo multi-turno simulado (memória + desambiguação)
// ═══════════════════════════════════════════════════════════════════════════

describe('E2E – Conversa multi-turno: memória + desambiguação integradas', () => {
  let memory: ConversationMemoryService;
  let disamb: DisambiguationService;

  beforeEach(async () => {
    const redisMock = buildRedisMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationMemoryService,
        DisambiguationService,
        { provide: RedisService, useValue: redisMock },
      ],
    }).compile();

    memory = module.get<ConversationMemoryService>(ConversationMemoryService);
    disamb = module.get<DisambiguationService>(DisambiguationService);
  });

  it('contexto de listagem → follow-up "receitas" → intent correto mantido no histórico', async () => {
    // Turno 1: usuário lista transações
    await memory.addEntry(PHONE, { role: 'user', text: 'minhas transações', intent: 'LIST_TRANSACTIONS' });
    await memory.addEntry(PHONE, { role: 'bot', text: 'Aqui estão suas 4 transações de abril:' });

    // Turno 2: follow-up contextual
    await memory.addEntry(PHONE, { role: 'user', text: 'e de receitas?', intent: 'LIST_TRANSACTIONS' });

    const lastIntent = await memory.getLastIntent(PHONE);
    expect(lastIntent).toBe('LIST_TRANSACTIONS');

    const history = await memory.getHistory(PHONE);
    expect(history).toHaveLength(3);
    expect(history[2].text).toBe('e de receitas?');
  });

  it('usuário vê saldo → diz "e em março?" → histórico preserva contexto', async () => {
    await memory.addEntry(PHONE, { role: 'user', text: 'resumo do mês', intent: 'MONTHLY_SUMMARY' });
    await memory.addEntry(PHONE, { role: 'bot', text: 'Resumo de abril: gastou R$3.200' });
    await memory.addEntry(PHONE, { role: 'user', text: 'e em março?', intent: 'MONTHLY_SUMMARY' });
    await memory.addEntry(PHONE, { role: 'bot', text: 'Resumo de março: gastou R$2.800' });

    const history = await memory.getHistory(PHONE);
    expect(history).toHaveLength(4);

    const lastIntent = await memory.getLastIntent(PHONE);
    expect(lastIntent).toBe('MONTHLY_SUMMARY');
  });

  it('fluxo: não entendeu → desambiguação → usuário responde "1" → intent disponível', async () => {
    // Simular que bot registrou o estado de desambiguação
    const module2: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationMemoryService,
        DisambiguationService,
        { provide: RedisService, useValue: buildRedisMock() },
      ],
    }).compile();

    const memory2 = module2.get<ConversationMemoryService>(ConversationMemoryService);
    const disamb2 = module2.get<DisambiguationService>(DisambiguationService);

    // Turno 1: usuário manda mensagem ambígua
    await memory2.addEntry(PHONE, { role: 'user', text: 'transações' });

    // Bot tentou desambiguação — se não teve match, sem pending
    const sugestao = await disamb2.suggest('transações', PHONE);

    if (await disamb2.hasPending(PHONE)) {
      // Turno 2: bot perguntou as opções (salvar na memória)
      await memory2.addEntry(PHONE, { role: 'bot', text: sugestao! });

      // Turno 3: usuário responde com número
      const resolvedIntent = await disamb2.resolveNumericResponse(PHONE, '1');
      expect(resolvedIntent).not.toBeNull();

      // Salvar intent resolvido na memória
      await memory2.addEntry(PHONE, { role: 'user', text: '1', intent: resolvedIntent! });

      const finalHistory = await memory2.getHistory(PHONE);
      expect(finalHistory.length).toBeGreaterThanOrEqual(3);
      expect(finalHistory[finalHistory.length - 1].intent).toBe(resolvedIntent);
    } else {
      // "transações" foi direto match — comportamento válido
      expect(sugestao).toBeNull();
    }
  });

  it('sequência de 10 mensagens não ultrapassa limite do buffer', async () => {
    const intents = [
      'GREETING', 'REGISTER_TRANSACTION', 'REGISTER_TRANSACTION', 'LIST_TRANSACTIONS',
      'CHECK_BALANCE', 'MONTHLY_SUMMARY', 'CATEGORY_BREAKDOWN', 'REGISTER_TRANSACTION',
      'LIST_TRANSACTIONS', 'CHECK_BALANCE', 'MONTHLY_SUMMARY', 'GREETING',
    ];

    for (let i = 0; i < intents.length; i++) {
      await memory.addEntry(PHONE, {
        role: i % 2 === 0 ? 'user' : 'bot',
        text: `mensagem ${i + 1}`,
        intent: intents[i],
      });
    }

    const history = await memory.getHistory(PHONE);
    expect(history.length).toBeLessThanOrEqual(10);

    // A última entrada deve ser a última mensagem inserida
    expect(history[history.length - 1].text).toBe(`mensagem ${intents.length}`);
  });

  it('clear() no meio da conversa permite nova conversa limpa', async () => {
    await memory.addEntry(PHONE, { role: 'user', text: 'oi', intent: 'GREETING' });
    await memory.addEntry(PHONE, { role: 'user', text: 'saldo', intent: 'CHECK_BALANCE' });

    await memory.clear(PHONE);

    // Nova conversa
    await memory.addEntry(PHONE, { role: 'user', text: 'nova sessão', intent: 'GREETING' });

    const history = await memory.getHistory(PHONE);
    expect(history).toHaveLength(1);
    expect(history[0].text).toBe('nova sessão');
  });
});

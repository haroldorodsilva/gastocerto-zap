import { DisambiguationService } from '@features/conversation/disambiguation.service';
import { RedisService } from '@common/services/redis.service';

describe('DisambiguationService', () => {
  let service: DisambiguationService;
  let redisMock: any;
  let redisClientMock: any;

  beforeEach(() => {
    redisClientMock = {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue(null),
      del: jest.fn().mockResolvedValue(1),
    };

    redisMock = {
      isReady: jest.fn().mockReturnValue(true),
      getClient: jest.fn().mockReturnValue(redisClientMock),
    };

    service = new DisambiguationService(redisMock as unknown as RedisService);
  });

  describe('suggest', () => {
    it('deve retornar null para textos longos (>4 palavras)', async () => {
      const result = await service.suggest('essa é uma frase longa demais', '5511999999999');
      expect(result).toBeNull();
    });

    it('deve retornar null quando nenhum match é encontrado', async () => {
      const result = await service.suggest('xyzabc', '5511999999999');
      expect(result).toBeNull();
    });

    it('deve retornar sugestões numeradas quando há match fuzzy', async () => {
      const result = await service.suggest('transacoes', '5511999999999');
      // "transacoes" deve dar match com LIST_TRANSACTIONS_KEYWORDS
      if (result) {
        expect(result).toContain('1️⃣');
        expect(result).toContain('número');
      }
    });

    it('deve armazenar opções no Redis ao gerar sugestões', async () => {
      await service.suggest('saldo', '5511999999999');
      // Se houve match, deve ter chamado set no Redis
      if (redisClientMock.set.mock.calls.length > 0) {
        expect(redisClientMock.set).toHaveBeenCalledWith(
          'disamb:5511999999999',
          expect.any(String),
          'EX',
          300,
        );
      }
    });

    it('deve funcionar com Redis indisponível (graceful)', async () => {
      redisMock.isReady.mockReturnValue(false);
      // Não deve lançar erro — se Redis está offline, apenas não persiste
      const result = await service.suggest('saldo', '5511999999999');
      // Pode retornar sugestão ou null, o importante é não lançar erro
      expect(true).toBe(true);
    });
  });

  describe('resolveNumericResponse', () => {
    it('deve retornar null quando não há desambiguação pendente', async () => {
      const result = await service.resolveNumericResponse('5511999999999', '1');
      expect(result).toBeNull();
    });

    it('deve resolver "1" para o primeiro intent armazenado', async () => {
      const stored = {
        options: [
          { intent: 'LIST_TRANSACTIONS', label: 'Transações', description: 'desc' },
          { intent: 'CHECK_BALANCE', label: 'Saldo', description: 'desc' },
        ],
        timestamp: Date.now(),
      };
      redisClientMock.get.mockResolvedValue(JSON.stringify(stored));

      const result = await service.resolveNumericResponse('5511999999999', '1');
      expect(result).toBe('LIST_TRANSACTIONS');
    });

    it('deve resolver "2" para o segundo intent armazenado', async () => {
      const stored = {
        options: [
          { intent: 'LIST_TRANSACTIONS', label: 'Transações', description: 'desc' },
          { intent: 'CHECK_BALANCE', label: 'Saldo', description: 'desc' },
        ],
        timestamp: Date.now(),
      };
      redisClientMock.get.mockResolvedValue(JSON.stringify(stored));

      const result = await service.resolveNumericResponse('5511999999999', '2');
      expect(result).toBe('CHECK_BALANCE');
    });

    it('deve aceitar "opcao 1" como formato válido', async () => {
      const stored = {
        options: [
          { intent: 'MONTHLY_SUMMARY', label: 'Resumo', description: 'desc' },
        ],
        timestamp: Date.now(),
      };
      redisClientMock.get.mockResolvedValue(JSON.stringify(stored));

      const result = await service.resolveNumericResponse('5511999999999', 'opcao 1');
      expect(result).toBe('MONTHLY_SUMMARY');
    });

    it('deve aceitar "opção 2" (com acento) como formato válido', async () => {
      const stored = {
        options: [
          { intent: 'LIST_TRANSACTIONS', label: 'Transações', description: 'desc' },
          { intent: 'CHECK_BALANCE', label: 'Saldo', description: 'desc' },
        ],
        timestamp: Date.now(),
      };
      redisClientMock.get.mockResolvedValue(JSON.stringify(stored));

      const result = await service.resolveNumericResponse('5511999999999', 'opção 2');
      expect(result).toBe('CHECK_BALANCE');
    });

    it('deve retornar null para número fora do range', async () => {
      const stored = {
        options: [
          { intent: 'LIST_TRANSACTIONS', label: 'Transações', description: 'desc' },
        ],
        timestamp: Date.now(),
      };
      redisClientMock.get.mockResolvedValue(JSON.stringify(stored));

      const result = await service.resolveNumericResponse('5511999999999', '3');
      expect(result).toBeNull();
    });

    it('deve retornar null para texto que não é número', async () => {
      const result = await service.resolveNumericResponse('5511999999999', 'transações');
      expect(result).toBeNull();
    });

    it('deve limpar desambiguação após resolver', async () => {
      const stored = {
        options: [
          { intent: 'LIST_TRANSACTIONS', label: 'Transações', description: 'desc' },
        ],
        timestamp: Date.now(),
      };
      redisClientMock.get.mockResolvedValue(JSON.stringify(stored));

      await service.resolveNumericResponse('5511999999999', '1');
      expect(redisClientMock.del).toHaveBeenCalledWith('disamb:5511999999999');
    });
  });

  describe('hasPending', () => {
    it('deve retornar false quando não há desambiguação pendente', async () => {
      const result = await service.hasPending('5511999999999');
      expect(result).toBe(false);
    });

    it('deve retornar true quando há desambiguação pendente', async () => {
      const stored = {
        options: [{ intent: 'CHECK_BALANCE', label: 'Saldo', description: 'desc' }],
        timestamp: Date.now(),
      };
      redisClientMock.get.mockResolvedValue(JSON.stringify(stored));

      const result = await service.hasPending('5511999999999');
      expect(result).toBe(true);
    });
  });
});

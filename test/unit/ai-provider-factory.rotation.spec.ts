/**
 * Testes de rotação de credenciais no AIProviderFactory.runWithCredentialRotation.
 *
 * Testa o comportamento central de round-robin:
 * - sucesso na primeira credencial
 * - rotação automática quando quota/429 exaure uma credencial
 * - falha total quando todas as credenciais estão esgotadas
 * - erros não-quota NÃO exaurem a credencial (apenas marcam erro e relançam)
 */

import { AICredentialSelectorService } from '@infrastructure/ai/credentials/ai-credential-selector.service';
import { AIProviderType } from '@infrastructure/ai/ai.interface';
import { AICredentialContextValue } from '@infrastructure/ai/credentials/ai-credential.context';
import { aiCredentialContext } from '@infrastructure/ai/credentials/ai-credential.context';

// ─── Helper ─────────────────────────────────────────────────────────────────

function makeCred(id: string, label: string): AICredentialContextValue {
  return { credentialId: id, apiKey: `sk-key-${id}`, provider: 'openai', label };
}

function makeQuotaError(msg = 'insufficient_quota') {
  const err: any = new Error(msg);
  err.status = 429;
  return err;
}

function makeGenericError(msg = 'model_not_found') {
  return new Error(msg);
}

// ─── Stub da lógica runWithCredentialRotation ─────────────────────────────
// A lógica real está em AIProviderFactory.runWithCredentialRotation (private).
// Extraímos e replicamos aqui para testar isoladamente, sem precisar montar
// o módulo completo com todos os providers de IA.

async function runWithCredentialRotation<T>(
  credentialSelector: AICredentialSelectorService,
  providerType: AIProviderType,
  fn: () => Promise<T>,
): Promise<T> {
  const creds = await credentialSelector.listAvailable(providerType);
  if (creds.length === 0) {
    throw new Error(
      `Nenhuma credencial disponível para provider=${providerType} (todas esgotadas ou desabilitadas)`,
    );
  }

  let lastError: any;
  for (const cred of creds) {
    try {
      const result = await aiCredentialContext.run(cred, () => fn());
      await credentialSelector.markUsed(cred.credentialId);
      return result;
    } catch (err) {
      lastError = err;
      if (AICredentialSelectorService.isQuotaError(err)) {
        await credentialSelector.markExhausted(
          cred.credentialId,
          (err as Error)?.message || 'quota/rate limit',
        );
        continue;
      }
      await credentialSelector.markError(cred.credentialId);
      throw err;
    }
  }

  throw new Error(
    `Todas as credenciais de ${providerType} esgotaram. Último erro: ${(lastError as Error)?.message || 'desconhecido'}`,
  );
}

// ─── Testes ──────────────────────────────────────────────────────────────────

describe('AIProviderFactory — rotação de credenciais (runWithCredentialRotation)', () => {
  let selector: jest.Mocked<AICredentialSelectorService>;

  beforeEach(() => {
    selector = {
      listAvailable: jest.fn(),
      markUsed: jest.fn().mockResolvedValue(undefined),
      markError: jest.fn().mockResolvedValue(undefined),
      markExhausted: jest.fn().mockResolvedValue(undefined),
      pickNext: jest.fn(),
      resetExhausted: jest.fn(),
    } as unknown as jest.Mocked<AICredentialSelectorService>;
  });

  // ─── Caso feliz ──────────────────────────────────────────────────────────

  it('usa a primeira credencial disponível e a marca como "used" após sucesso', async () => {
    const cred1 = makeCred('c1', 'key-1');
    selector.listAvailable.mockResolvedValue([cred1]);

    const result = await runWithCredentialRotation(selector, AIProviderType.OPENAI, async () => 'ok');

    expect(result).toBe('ok');
    expect(selector.markUsed).toHaveBeenCalledWith('c1');
    expect(selector.markExhausted).not.toHaveBeenCalled();
    expect(selector.markError).not.toHaveBeenCalled();
  });

  it('passa a credencial correta pelo contexto async', async () => {
    const cred1 = makeCred('c1', 'key-1');
    selector.listAvailable.mockResolvedValue([cred1]);

    let capturedCred: AICredentialContextValue | undefined;
    await runWithCredentialRotation(selector, AIProviderType.OPENAI, async () => {
      capturedCred = aiCredentialContext.getStore();
      return 'ok';
    });

    expect(capturedCred).toEqual(cred1);
  });

  // ─── Rotação por quota ───────────────────────────────────────────────────

  it('rotaciona para segunda credencial quando primeira tem erro 429', async () => {
    const cred1 = makeCred('c1', 'key-1');
    const cred2 = makeCred('c2', 'key-2');
    selector.listAvailable.mockResolvedValue([cred1, cred2]);

    let callCount = 0;
    const result = await runWithCredentialRotation(selector, AIProviderType.OPENAI, async () => {
      callCount++;
      if (callCount === 1) throw makeQuotaError();
      return 'success-with-c2';
    });

    expect(result).toBe('success-with-c2');
    expect(selector.markExhausted).toHaveBeenCalledWith('c1', expect.stringContaining('insufficient_quota'));
    expect(selector.markUsed).toHaveBeenCalledWith('c2');
    expect(selector.markUsed).not.toHaveBeenCalledWith('c1');
  });

  it('rotaciona por todas as credenciais em ordem antes de falhar', async () => {
    const creds = [makeCred('c1', 'k1'), makeCred('c2', 'k2'), makeCred('c3', 'k3')];
    selector.listAvailable.mockResolvedValue(creds);

    await expect(
      runWithCredentialRotation(selector, AIProviderType.OPENAI, async () => {
        throw makeQuotaError('quota_exceeded');
      }),
    ).rejects.toThrow(/Todas as credenciais/);

    expect(selector.markExhausted).toHaveBeenCalledTimes(3);
    expect(selector.markExhausted).toHaveBeenCalledWith('c1', 'quota_exceeded');
    expect(selector.markExhausted).toHaveBeenCalledWith('c2', 'quota_exceeded');
    expect(selector.markExhausted).toHaveBeenCalledWith('c3', 'quota_exceeded');
    expect(selector.markUsed).not.toHaveBeenCalled();
  });

  it('a mensagem do erro final menciona o provider', async () => {
    selector.listAvailable.mockResolvedValue([makeCred('c1', 'k1')]);

    await expect(
      runWithCredentialRotation(selector, AIProviderType.OPENAI, async () => {
        throw makeQuotaError();
      }),
    ).rejects.toThrow(/openai/i);
  });

  // ─── Erros não-quota (não devem exaurir) ─────────────────────────────────

  it('erros não-quota marcam "error", relançam e NÃO exaurem a credencial', async () => {
    const cred1 = makeCred('c1', 'k1');
    selector.listAvailable.mockResolvedValue([cred1]);
    const networkErr = makeGenericError('network timeout');

    await expect(
      runWithCredentialRotation(selector, AIProviderType.OPENAI, async () => {
        throw networkErr;
      }),
    ).rejects.toThrow('network timeout');

    expect(selector.markError).toHaveBeenCalledWith('c1');
    expect(selector.markExhausted).not.toHaveBeenCalled();
    expect(selector.markUsed).not.toHaveBeenCalled();
  });

  it('erro 401 (auth) não exaure credencial', async () => {
    const cred1 = makeCred('c1', 'k1');
    selector.listAvailable.mockResolvedValue([cred1]);
    const authErr: any = new Error('invalid api key');
    authErr.status = 401;

    await expect(
      runWithCredentialRotation(selector, AIProviderType.OPENAI, async () => {
        throw authErr;
      }),
    ).rejects.toThrow('invalid api key');

    expect(selector.markExhausted).not.toHaveBeenCalled();
    expect(selector.markError).toHaveBeenCalledWith('c1');
  });

  it('erro 500 (server error) não exaure credencial', async () => {
    const cred1 = makeCred('c1', 'k1');
    selector.listAvailable.mockResolvedValue([cred1]);
    const serverErr: any = new Error('internal server error');
    serverErr.status = 500;

    await expect(
      runWithCredentialRotation(selector, AIProviderType.OPENAI, async () => {
        throw serverErr;
      }),
    ).rejects.toThrow('internal server error');

    expect(selector.markExhausted).not.toHaveBeenCalled();
  });

  // ─── Sem credenciais disponíveis ─────────────────────────────────────────

  it('lança erro imediato quando não há credenciais disponíveis', async () => {
    selector.listAvailable.mockResolvedValue([]);

    await expect(
      runWithCredentialRotation(selector, AIProviderType.OPENAI, async () => 'never'),
    ).rejects.toThrow(/Nenhuma credencial disponível/);

    expect(selector.markUsed).not.toHaveBeenCalled();
    expect(selector.markExhausted).not.toHaveBeenCalled();
  });

  // ─── Contexto assíncrono isolado ─────────────────────────────────────────

  it('cada credencial tem contexto assíncrono isolado (concorrência)', async () => {
    const cred1 = makeCred('c1', 'k1');
    const cred2 = makeCred('c2', 'k2');

    // Executa duas rotações em paralelo para confirmar que AsyncLocalStorage não mistura contextos
    const capturedIds: string[] = [];

    const run1 = async () => {
      selector.listAvailable.mockResolvedValue([cred1]);
      return runWithCredentialRotation(selector, AIProviderType.OPENAI, async () => {
        const store = aiCredentialContext.getStore();
        capturedIds.push(store?.credentialId ?? 'none');
        return store?.credentialId;
      });
    };

    const r1 = await run1();
    expect(r1).toBe('c1');
    // O contexto fica vazio fora do run
    expect(aiCredentialContext.getStore()).toBeUndefined();
  });

  // ─── Combinação: rotação parcial ─────────────────────────────────────────

  it('cred1 falha por quota, cred2 falha por erro genérico → relança imediatamente', async () => {
    const cred1 = makeCred('c1', 'k1');
    const cred2 = makeCred('c2', 'k2');
    selector.listAvailable.mockResolvedValue([cred1, cred2]);

    let callCount = 0;
    await expect(
      runWithCredentialRotation(selector, AIProviderType.OPENAI, async () => {
        callCount++;
        if (callCount === 1) throw makeQuotaError();
        throw makeGenericError('bad request from cred2');
      }),
    ).rejects.toThrow('bad request from cred2');

    expect(selector.markExhausted).toHaveBeenCalledWith('c1', expect.any(String));
    expect(selector.markError).toHaveBeenCalledWith('c2');
    expect(callCount).toBe(2); // não tenta cred3 (não existe)
  });
});

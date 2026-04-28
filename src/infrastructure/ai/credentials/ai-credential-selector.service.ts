import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CryptoService } from '../../../common/services/crypto.service';
import { AIProviderType } from '../ai.interface';
import { AICredentialContextValue } from './ai-credential.context';

const PROVIDER_TYPE_TO_DB: Partial<Record<AIProviderType, string>> = {
  [AIProviderType.OPENAI]: 'openai',
  [AIProviderType.GOOGLE_GEMINI]: 'google_gemini',
  [AIProviderType.GROQ]: 'groq',
  [AIProviderType.DEEPSEEK]: 'deepseek',
};

/**
 * 🆕 [AI2] Seleciona credenciais (chaves) de IA via round-robin com flag de "exhausted".
 *
 * Estratégia:
 * - Filtra por `isActive=true AND isExhausted=false`.
 * - Ordena por `priority ASC, lastUsedAt ASC NULLS FIRST` → próxima chave menos usada.
 * - Quando a chamada falha por quota/429, marca `isExhausted=true` (cron diário reseta).
 */
@Injectable()
export class AICredentialSelectorService {
  private readonly logger = new Logger(AICredentialSelectorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Retorna a próxima credencial disponível para o provider, em ordem round-robin.
   * Retorna `null` se não houver nenhuma ativa/não-esgotada.
   */
  async pickNext(provider: AIProviderType): Promise<AICredentialContextValue | null> {
    const dbProvider = PROVIDER_TYPE_TO_DB[provider];
    if (!dbProvider) return null;

    const cred = await this.prisma.aIProviderCredential.findFirst({
      where: { provider: dbProvider, isActive: true, isExhausted: false },
      orderBy: [{ priority: 'asc' }, { lastUsedAt: { sort: 'asc', nulls: 'first' } }],
    });

    if (!cred) {
      this.logger.warn(`⚠️  Nenhuma credencial ativa disponível para provider=${dbProvider}`);
      return null;
    }

    let apiKey: string;
    try {
      apiKey = this.crypto.decrypt(cred.apiKey);
    } catch {
      // Suporte a chaves inseridas em texto puro (durante setup inicial)
      apiKey = cred.apiKey;
    }

    return {
      credentialId: cred.id,
      apiKey,
      provider: cred.provider,
      label: cred.label,
    };
  }

  /**
   * Lista todas as credenciais ativas/não-esgotadas em ordem (para iteração no factory).
   */
  async listAvailable(provider: AIProviderType): Promise<AICredentialContextValue[]> {
    const dbProvider = PROVIDER_TYPE_TO_DB[provider];
    if (!dbProvider) return [];

    const creds = await this.prisma.aIProviderCredential.findMany({
      where: { provider: dbProvider, isActive: true, isExhausted: false },
      orderBy: [{ priority: 'asc' }, { lastUsedAt: { sort: 'asc', nulls: 'first' } }],
    });

    return creds.map((c) => {
      let apiKey: string;
      try {
        apiKey = this.crypto.decrypt(c.apiKey);
      } catch {
        apiKey = c.apiKey;
      }
      return {
        credentialId: c.id,
        apiKey,
        provider: c.provider,
        label: c.label,
      };
    });
  }

  async markUsed(credentialId: string): Promise<void> {
    await this.prisma.aIProviderCredential
      .update({
        where: { id: credentialId },
        data: { lastUsedAt: new Date(), totalRequests: { increment: 1 } },
      })
      .catch((err) => this.logger.warn(`markUsed falhou: ${err.message}`));
  }

  async markError(credentialId: string): Promise<void> {
    await this.prisma.aIProviderCredential
      .update({
        where: { id: credentialId },
        data: { totalErrors: { increment: 1 } },
      })
      .catch((err) => this.logger.warn(`markError falhou: ${err.message}`));
  }

  async markExhausted(credentialId: string, reason: string): Promise<void> {
    this.logger.warn(`🔴 Credencial ${credentialId} marcada como exhausted: ${reason}`);
    await this.prisma.aIProviderCredential
      .update({
        where: { id: credentialId },
        data: {
          isExhausted: true,
          exhaustedAt: new Date(),
          exhaustedReason: reason.slice(0, 250),
        },
      })
      .catch((err) => this.logger.error(`markExhausted falhou: ${err.message}`));
  }

  /**
   * 🆕 [AI4] Reset diário — limpa flag `isExhausted` de todas as credenciais.
   * Chamado pelo cron `AICredentialResetCron`.
   */
  async resetExhausted(): Promise<number> {
    const result = await this.prisma.aIProviderCredential.updateMany({
      where: { isExhausted: true },
      data: { isExhausted: false, exhaustedAt: null, exhaustedReason: null },
    });
    if (result.count > 0) {
      this.logger.log(`♻️  [AI4] Reset diário: ${result.count} credencial(is) reativada(s)`);
    }
    return result.count;
  }

  /**
   * Detecta se o erro é por quota/rate-limit (HTTP 429 ou similar).
   */
  static isQuotaError(error: any): boolean {
    if (!error) return false;
    const status = error.status || error.statusCode || error.response?.status;
    if (status === 429) return true;
    const msg = (error.message || '').toLowerCase();
    return (
      msg.includes('quota') ||
      msg.includes('rate limit') ||
      msg.includes('rate_limit') ||
      msg.includes('insufficient_quota') ||
      msg.includes('billing') ||
      msg.includes('exceeded')
    );
  }
}

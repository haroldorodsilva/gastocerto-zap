import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@common/services/redis.service';
import { normalizeForIntent, fuzzyMatchKeyword } from '@shared/utils/string-utils';
import {
  LIST_TRANSACTIONS_KEYWORDS,
  BALANCE_KEYWORDS,
  MONTHLY_SUMMARY_KEYWORDS,
  CATEGORY_BREAKDOWN_KEYWORDS,
  LIST_CREDIT_CARDS_KEYWORDS,
  LIST_INVOICES_KEYWORDS,
} from '@features/intent/intent-keywords';

interface DisambiguationOption {
  intent: string;
  label: string;
  description: string;
}

interface StoredDisambiguation {
  options: DisambiguationOption[];
  timestamp: number;
}

const DISAMBIGUATION_PREFIX = 'disamb:';
const DISAMBIGUATION_TTL = 5 * 60; // 5 minutos

/**
 * Gera sugestões de desambiguação quando a intenção não é clara.
 * Oferece opções rápidas ao invés de uma mensagem genérica de "não entendi".
 * Armazena estado no Redis para resolver respostas numéricas ("1", "2", "3").
 */
@Injectable()
export class DisambiguationService {
  private readonly logger = new Logger(DisambiguationService.name);

  constructor(private readonly redisService: RedisService) {}

  private readonly intentOptions: Array<{
    keywords: readonly string[];
    option: DisambiguationOption;
  }> = [
    {
      keywords: LIST_TRANSACTIONS_KEYWORDS,
      option: { intent: 'LIST_TRANSACTIONS', label: '📋 Minhas transações', description: 'Ver transações do mês' },
    },
    {
      keywords: BALANCE_KEYWORDS,
      option: { intent: 'CHECK_BALANCE', label: '💰 Meu saldo', description: 'Ver balanço geral' },
    },
    {
      keywords: MONTHLY_SUMMARY_KEYWORDS,
      option: { intent: 'MONTHLY_SUMMARY', label: '📊 Resumo do mês', description: 'Resumo mensal detalhado' },
    },
    {
      keywords: CATEGORY_BREAKDOWN_KEYWORDS,
      option: { intent: 'CATEGORY_BREAKDOWN', label: '📂 Gastos por categoria', description: 'Análise por categoria' },
    },
    {
      keywords: LIST_CREDIT_CARDS_KEYWORDS,
      option: { intent: 'LIST_CREDIT_CARDS', label: '💳 Meus cartões', description: 'Ver cartões de crédito' },
    },
    {
      keywords: LIST_INVOICES_KEYWORDS,
      option: { intent: 'LIST_INVOICES', label: '🧾 Minhas faturas', description: 'Ver faturas de cartão' },
    },
  ];

  /**
   * Tenta gerar sugestões relevantes com base no texto não reconhecido.
   * Armazena as opções no Redis para resolver respostas numéricas depois.
   * Retorna null se não encontrar sugestões próximas (cai no UNKNOWN genérico).
   */
  async suggest(text: string, phoneNumber: string): Promise<string | null> {
    const normalized = normalizeForIntent(text);
    const words = normalized.split(/\s+/);

    // Só tentar desambiguação para textos curtos (1-4 palavras)
    if (words.length > 4) return null;

    // Buscar opções com similaridade fuzzy
    const matches: DisambiguationOption[] = [];

    for (const group of this.intentOptions) {
      const normalizedKeywords = group.keywords.map((k) => normalizeForIntent(k));
      const match = fuzzyMatchKeyword(normalized, normalizedKeywords, 0.55);
      if (match) {
        matches.push(group.option);
      }
    }

    if (matches.length === 0) return null;

    const selectedOptions = matches.slice(0, 3);

    // Armazenar opções no Redis para resolver respostas numéricas
    await this.storeDisambiguation(phoneNumber, selectedOptions);

    // Montar mensagem de desambiguação com números
    let msg = '🤔 Hmm, não entendi direito. Você quis dizer:\n\n';
    selectedOptions.forEach((o, i) => {
      msg += `${i + 1}️⃣ *${o.label}* — _${o.description}_\n`;
    });
    msg += '\nDigite o *número* da opção ou _"ajuda"_ pra ver tudo que posso fazer. 😉';

    return msg;
  }

  /**
   * Tenta resolver uma resposta numérica ("1", "2", "3") a partir de
   * uma desambiguação pendente armazenada no Redis.
   * Retorna o intent correspondente ou null se não houver desambiguação pendente.
   */
  async resolveNumericResponse(phoneNumber: string, text: string): Promise<string | null> {
    const normalized = text.trim();

    // Aceitar "1", "2", "3" ou variações como "opcao 1", "opção 2"
    const cleaned = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const match = cleaned.match(/^(?:opcao\s+)?([1-3])$/);
    if (!match) return null;

    const index = parseInt(match[1], 10) - 1;

    const stored = await this.getStoredDisambiguation(phoneNumber);
    if (!stored || index >= stored.options.length) return null;

    const selectedIntent = stored.options[index].intent;
    this.logger.log(`✅ Desambiguação resolvida: opção ${index + 1} → ${selectedIntent}`);

    // Limpar estado após resolver
    await this.clearDisambiguation(phoneNumber);

    return selectedIntent;
  }

  /**
   * Verifica se há desambiguação pendente para o usuário
   */
  async hasPending(phoneNumber: string): Promise<boolean> {
    const stored = await this.getStoredDisambiguation(phoneNumber);
    return stored !== null;
  }

  private async storeDisambiguation(phoneNumber: string, options: DisambiguationOption[]): Promise<void> {
    try {
      if (!this.redisService.isReady()) return;

      const client = this.redisService.getClient();
      const key = `${DISAMBIGUATION_PREFIX}${phoneNumber}`;
      const data: StoredDisambiguation = { options, timestamp: Date.now() };

      await client.set(key, JSON.stringify(data), 'EX', DISAMBIGUATION_TTL);
    } catch (error) {
      this.logger.warn(`Falha ao salvar desambiguação: ${error.message}`);
    }
  }

  private async getStoredDisambiguation(phoneNumber: string): Promise<StoredDisambiguation | null> {
    try {
      if (!this.redisService.isReady()) return null;

      const client = this.redisService.getClient();
      const key = `${DISAMBIGUATION_PREFIX}${phoneNumber}`;
      const raw = await client.get(key);

      if (!raw) return null;
      return JSON.parse(raw) as StoredDisambiguation;
    } catch (error) {
      this.logger.warn(`Falha ao ler desambiguação: ${error.message}`);
      return null;
    }
  }

  private async clearDisambiguation(phoneNumber: string): Promise<void> {
    try {
      if (!this.redisService.isReady()) return;
      const client = this.redisService.getClient();
      await client.del(`${DISAMBIGUATION_PREFIX}${phoneNumber}`);
    } catch {
      // silent
    }
  }
}

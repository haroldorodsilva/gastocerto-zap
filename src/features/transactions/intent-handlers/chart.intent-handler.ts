import { Injectable, Logger } from '@nestjs/common';
import { MessageIntent } from '@features/intent/intent-analyzer.service';
import { GastoCertoApiService } from '@shared/gasto-certo-api.service';
import { IntentHandler, IntentHandlerContext } from './intent-handler.interface';
import { ProcessMessageResult } from '../transactions.types';

/**
 * Handler para intent de geração de gráfico
 *
 * Intents: GENERATE_CHART
 * Gera gráfico doughnut de categorias (igual ao frontend) + resumo textual
 */
@Injectable()
export class ChartIntentHandler implements IntentHandler {
  private readonly logger = new Logger(ChartIntentHandler.name);

  readonly supportedIntents = [MessageIntent.GENERATE_CHART];

  constructor(private readonly gastoCertoApi: GastoCertoApiService) {}

  async handle(ctx: IntentHandlerContext): Promise<ProcessMessageResult> {
    const { user, intentResult } = ctx;
    const monthReference = intentResult.metadata?.monthReference;
    const chartType = intentResult.metadata?.chartType || 'categories';

    const targetMonth = monthReference || this.getCurrentMonthReference();
    const [year, month] = targetMonth.split('-').map(Number);

    const monthNames = [
      'Janeiro',
      'Fevereiro',
      'Março',
      'Abril',
      'Maio',
      'Junho',
      'Julho',
      'Agosto',
      'Setembro',
      'Outubro',
      'Novembro',
      'Dezembro',
    ];
    const monthLabel = `${monthNames[month - 1]} ${year}`;

    this.logger.log(
      `📊 Gerando gráfico: type=${chartType}, month=${targetMonth}, accountId=${user.activeAccountId}`,
    );

    try {
      // Gráfico de categorias (despesas) — mesmo que o frontend
      const type = chartType === 'income' ? 'INCOME' : 'EXPENSE';
      const typeLabel = type === 'INCOME' ? 'Receitas' : 'Despesas';

      const result = await this.gastoCertoApi.getCategoryChart(
        user.activeAccountId,
        year,
        month,
        type as any,
        user.gastoCertoId,
      );

      if (!result.success || !result.imageBuffer) {
        return {
          success: false,
          message: '❌ Não foi possível gerar o gráfico. Tente novamente.',
          requiresConfirmation: false,
          replyContext: 'INTENT_RESPONSE',
        };
      }

      // Montar mensagem com resumo das categorias
      const message = this.formatCategorySummary(typeLabel, monthLabel, result.categories || []);

      return {
        success: true,
        message,
        imageBuffer: result.imageBuffer,
        requiresConfirmation: false,
        replyContext: 'INTENT_RESPONSE',
      };
    } catch (error) {
      this.logger.error('❌ Erro ao gerar gráfico:', error);
      return {
        success: false,
        message: '❌ Erro ao gerar o gráfico. Tente novamente em alguns instantes.',
        requiresConfirmation: false,
        replyContext: 'INTENT_RESPONSE',
      };
    }
  }

  /**
   * Formata resumo textual das categorias (acompanha o gráfico)
   */
  private formatCategorySummary(typeLabel: string, monthLabel: string, categories: any[]): string {
    if (!categories || categories.length === 0) {
      return `📊 *${typeLabel} por Categoria - ${monthLabel}*\n\nNenhuma transação encontrada neste período.`;
    }

    const total = categories.reduce((sum: number, cat: any) => sum + (cat.value || 0), 0);
    const totalFormatted = this.formatCurrency(total);

    const sorted = [...categories].sort((a: any, b: any) =>
      (a.label || '').localeCompare(b.label || '', 'pt-BR'),
    );

    let msg = `📊 *${typeLabel} por Categoria - ${monthLabel}*\n`;
    msg += `💰 Total: *${totalFormatted}*\n\n`;

    for (const cat of sorted) {
      const amount = this.formatCurrency(cat.value || 0);
      const pct = cat.percent?.toFixed(1) || '0.0';
      msg += `• *${cat.label}*: ${amount} (${pct}%)\n`;

      // Subcategorias
      if (cat.subCategories?.length > 0) {
        for (const sub of cat.subCategories) {
          const subAmount = this.formatCurrency(sub.value || 0);
          const subPct = sub.percent?.toFixed(1) || '0.0';
          msg += `  ↳ ${sub.label}: ${subAmount} (${subPct}%)\n`;
        }
      }
    }

    msg += `\n💡 _Visualize também no site: gastocerto.com.br/financial-analysis_`;
    return msg;
  }

  private formatCurrency(centavos: number): string {
    return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  private getCurrentMonthReference(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
}

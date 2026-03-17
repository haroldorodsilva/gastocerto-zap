import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { ServiceAuthService } from '@common/services/service-auth.service';
import { DiscordNotificationService } from '@common/services/discord-notification.service';
import { GastoCertoApiClientBase } from './api-client.base';
import {
  CreateGastoCertoTransactionDto,
  GastoCertoTransactionResponseDto,
} from '@features/transactions/dto/transaction.dto';
import { MonthlyBalanceRelations } from '../../models/monthly-balance.entity';
import { ListTransactionsResponseDto } from '../types';

/**
 * GastoCerto API client for Transaction and Balance operations.
 *
 * Methods:
 * - createTransaction, listTransactions, payTransaction
 * - getPendingBillsByCategory, getPendingPayments
 * - getMonthlySummary, getCategoryBreakdown, getOverallBalance, getMonthlyBalance
 */
@Injectable()
export class TransactionApiClient extends GastoCertoApiClientBase {
  constructor(
    configService: ConfigService,
    httpService: HttpService,
    serviceAuthService: ServiceAuthService,
    discordNotification: DiscordNotificationService,
  ) {
    super(
      'TransactionApiClient',
      configService,
      httpService,
      serviceAuthService,
      discordNotification,
    );
  }

  async createTransaction(
    data: CreateGastoCertoTransactionDto,
  ): Promise<GastoCertoTransactionResponseDto> {
    try {
      this.logger.log(
        `Criando transação para usuário ${data.userId}: ${data.type} R$ ${data.amount}`,
      );

      const result = await this.post<GastoCertoTransactionResponseDto>(
        '/external/transactions',
        data,
      );

      if (result.success) {
        this.logger.log(`✅ Transação criada com sucesso`);
        return { success: true };
      } else if (result.error) {
        this.logger.error(
          `❌ Erro ao criar transação: ${result.error.code} - ${result.error.message}`,
        );
        return { success: false, error: result.error };
      }

      return {
        success: false,
        error: { code: 'INVALID_RESPONSE', message: 'Resposta inválida da API' },
      };
    } catch (error: any) {
      this.logger.error(`❌ Erro ao criar transação: ${error.message}`);

      if (error.response) {
        this.logger.error(
          `📋 Status: ${error.response.status} | Data: ${JSON.stringify(error.response.data)}`,
        );
      }

      if (error.response?.data?.error) {
        return {
          success: false,
          message: error.response.data.message || 'Erro ao criar transação',
          error: error.response.data.error,
        };
      }

      throw new HttpException(
        error.response?.data?.message || 'Erro ao criar transação',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async listTransactions(
    userId: string,
    filters: {
      accountId: string;
      monthYear: string;
      type?: 'INCOME' | 'EXPENSES';
      status?: 'PENDING' | 'DONE' | 'OVERDUE';
      categoryId?: string;
      page?: number;
      limit?: number;
    },
  ): Promise<ListTransactionsResponseDto> {
    try {
      this.logger.log(`📋 Listando transações - userId: ${userId}`);
      this.logger.log(`   Filtros:`, JSON.stringify(filters || {}));

      const body = { userId, ...filters };
      const result = await this.post<ListTransactionsResponseDto>(
        '/external/transactions/list',
        body,
      );

      if (result.success) {
        this.logger.log(`✅ ${result.data?.data?.length || 0} transações encontradas`);
      }
      return result;
    } catch (error: any) {
      this.logDetailedError(`${this.baseUrl}/external/transactions/list`, error);
      return { success: false };
    }
  }

  async payTransaction(
    userId: string,
    accountId: string,
    transactionId: string,
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      this.logger.log(
        `💳 Pagando transação ${transactionId} - userId: ${userId} - accountId: ${accountId}`,
      );

      const body = { userId, accountId, transactionId };
      const result = await this.post<{ success: boolean; message?: string; error?: string }>(
        '/external/transactions/pay',
        body,
      );

      if (result.success) {
        this.logger.log(`✅ Transação paga com sucesso: ${transactionId}`);
      }
      return result;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao pagar transação:`);
      this.logDetailedError(`${this.baseUrl}/external/transactions/pay`, error);
      return { success: false, error: this.getUserFriendlyError(error) };
    }
  }

  async getPendingBillsByCategory(
    userId: string,
    accountId: string,
    categoryId: string,
  ): Promise<ListTransactionsResponseDto> {
    try {
      const now = new Date();
      const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      this.logger.log(
        `🧾 Buscando contas pendentes da categoria ${categoryId} - userId: ${userId}, accountId: ${accountId}, monthYear: ${monthYear}`,
      );

      const result = await this.listTransactions(userId, {
        accountId,
        monthYear,
        status: 'PENDING',
        categoryId,
      });

      if (!result.success) {
        return { success: false, error: 'Erro ao buscar transações pendentes' };
      }

      // FILTRO ADICIONAL: Remover DONE que vieram incorretamente
      if (result.data?.data) {
        const originalCount = result.data.data.length;
        result.data.data = result.data.data.filter((t: any) => t.status !== 'DONE');
        if (originalCount !== result.data.data.length) {
          this.logger.warn(
            `⚠️ Removidas ${originalCount - result.data.data.length} transações DONE que vieram incorretamente`,
          );
        }
      }

      this.logger.log(
        `✅ ${result.data?.data?.length || 0} contas pendentes da categoria ${categoryId}`,
      );
      return result;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao buscar contas pendentes: ${error.message}`);
      return { success: false, error: this.getUserFriendlyError(error) };
    }
  }

  async getPendingPayments(
    userId: string,
    accountId: string,
  ): Promise<ListTransactionsResponseDto> {
    try {
      const now = new Date();
      const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      this.logger.log(
        `[getPendingPayments] 📋 Buscando pagamentos pendentes - userId: ${userId}, accountId: ${accountId}, monthYear: ${monthYear}`,
      );

      const result = await this.listTransactions(userId, {
        accountId,
        monthYear,
        status: 'PENDING',
      });

      if (!result.success) return result;

      // FILTRO ADICIONAL: Remover DONE que vieram incorretamente
      if (result.data?.data) {
        const originalCount = result.data.data.length;
        result.data.data = result.data.data.filter((t: any) => t.status !== 'DONE');
        if (originalCount !== result.data.data.length) {
          this.logger.warn(
            `⚠️ Removidas ${originalCount - result.data.data.length} transações DONE que vieram incorretamente`,
          );
        }
      }

      this.logger.log(
        `[getPendingPayments] ✅ ${result.data?.data?.length || 0} pendentes encontrados`,
      );
      return result;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao buscar pagamentos pendentes: ${error.message}`);
      return { success: false, error: this.getUserFriendlyError(error) };
    }
  }

  // ─── Balance ────────────────────────────────────────────────

  async getMonthlySummary(
    accountId: string,
    month?: number,
    year?: number,
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const currentDate = new Date();
      const targetMonth = month || currentDate.getMonth() + 1;
      const targetYear = year || currentDate.getFullYear();

      this.logger.log(
        `📊 Buscando resumo mensal ${targetYear}-${targetMonth.toString().padStart(2, '0')}`,
      );

      const body = { accountId, month: targetMonth, year: targetYear };
      const data = await this.post('/external/balance/monthly-resume', body);

      this.logger.log(`✅ Resumo mensal obtido com sucesso`);
      return { success: true, data };
    } catch (error: any) {
      this.logger.error(`❌ Erro ao buscar resumo mensal:`);
      this.logDetailedError(`${this.baseUrl}/external/balance/monthly-resume`, error);
      return { success: false, error: this.getUserFriendlyError(error) };
    }
  }

  async getCategoryBreakdown(
    accountId: string,
    monthReference: string,
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      this.logger.log(
        `📊 Buscando análise por categoria - accountId: ${accountId}, mês: ${monthReference}`,
      );

      const [year, month] = monthReference.split('-').map(Number);
      const body = { accountId, month, year };
      const data = await this.post('/external/balance/category-breakdown', body);

      this.logger.log(`✅ Análise de categorias recebida`);
      return { success: true, data };
    } catch (error: any) {
      this.logger.error(`❌ Erro ao buscar análise de categorias:`);
      this.logDetailedError(`${this.baseUrl}/external/balance/category-breakdown`, error);
      return { success: false, error: this.getUserFriendlyError(error) };
    }
  }

  async getOverallBalance(
    userId: string,
    accountId: string,
  ): Promise<{
    success: boolean;
    data?: { resume: MonthlyBalanceRelations };
    error?: string;
  }> {
    try {
      this.logger.log(
        `💰 Buscando balanço geral (mês atual) - userId: ${userId}, accountId: ${accountId}`,
      );

      const body = { userId, accountId };
      const data = await this.post<any>('/external/balance/monthly-resume', body);

      this.logger.log(`✅ Balanço geral recebido - Balance: R$ ${(data.balance / 100).toFixed(2)}`);
      return { success: true, data };
    } catch (error: any) {
      this.logger.error(`❌ Erro ao buscar balanço geral:`);
      this.logDetailedError(`${this.baseUrl}/external/balance/monthly-resume`, error);
      return { success: false, error: this.getUserFriendlyError(error) };
    }
  }

  async getMonthlyBalance(
    userId: string,
    monthYear?: string,
  ): Promise<{
    success: boolean;
    resume?: {
      yearMonth: string;
      startingBalance: number;
      income: number;
      expenses: number;
      balance: number;
      predictedFinalBalance: number;
      cardExpenses: number;
      paidIncome: number;
      paidExpenses: number;
      pendingIncome: number;
      pendingExpenses: number;
    };
  }> {
    try {
      const month = monthYear || new Date().toISOString().slice(0, 7);
      this.logger.log(`💰 Buscando resumo mensal - userId: ${userId}, month: ${month}`);

      const body = { userId, monthYear: month };
      const data = await this.post<any>('/external/balance/monthly-resume', body);

      if (data.success) {
        this.logger.log(`✅ Resumo mensal obtido - Balance: ${data.resume.balance}`);
      }
      return data;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao buscar resumo mensal:`, error.message);
      return { success: false };
    }
  }
}

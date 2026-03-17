import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { ServiceAuthService } from '@common/services/service-auth.service';
import { DiscordNotificationService } from '@common/services/discord-notification.service';
import { GastoCertoApiClientBase } from './api-client.base';
import { CreditCardResponseDto } from '../types';
import { CreditCardInvoiceRelations } from '../../models/credit-card-invoices.entity';

/**
 * GastoCerto API client for Credit Card operations.
 *
 * Methods:
 * - listCreditCards, getInvoiceDetails, listCreditCardInvoices
 * - payInvoice, payCreditCardInvoice
 */
@Injectable()
export class CreditCardApiClient extends GastoCertoApiClientBase {
  constructor(
    configService: ConfigService,
    httpService: HttpService,
    serviceAuthService: ServiceAuthService,
    discordNotification: DiscordNotificationService,
  ) {
    super(
      'CreditCardApiClient',
      configService,
      httpService,
      serviceAuthService,
      discordNotification,
    );
  }

  async listCreditCards(accountId: string): Promise<{
    success: boolean;
    data?: CreditCardResponseDto[];
    error?: string;
  }> {
    try {
      this.logger.log(`💳 Listando cartões - accountId: ${accountId}`);

      const result = await this.post<{ cards: CreditCardResponseDto[] }>('/external/cards', {
        accountId,
      });

      if (result.cards) {
        this.logger.log(`✅ ${result.cards.length} cartão(ões) encontrado(s)`);
      }

      return { success: true, data: result.cards };
    } catch (error: any) {
      this.logDetailedError(`${this.baseUrl}/external/cards`, error);
      return { success: false, error: this.getUserFriendlyError(error) };
    }
  }

  /**
   * Busca detalhes completos de uma fatura de cartão
   * Endpoint: POST /external/cards/invoices/details
   */
  async getInvoiceDetails(
    accountId: string,
    yearMonth: string,
    creditCardId: string,
  ): Promise<{
    success: boolean;
    invoice?: CreditCardInvoiceRelations;
    error?: string;
  }> {
    try {
      this.logger.log(
        `💳 Buscando detalhes da fatura ${yearMonth} - accountId: ${accountId}, creditCardId: ${creditCardId}`,
      );

      const body = { accountId, yearMonth, creditCardId };
      const result = await this.post<any>('/external/cards/invoices/details', body);

      if (result) {
        this.logger.log(`✅ Fatura ${yearMonth} - ${result.invoices?.length || 0} transação(ões)`);
      }

      return result;
    } catch (error: any) {
      this.logDetailedError(`${this.baseUrl}/external/cards/invoices/details`, error);
      return { success: false, error: this.getUserFriendlyError(error) };
    }
  }

  /**
   * Lista faturas de cartão de crédito
   * Endpoint: POST /external/cards/invoices
   * Se creditCardId não for fornecido, retorna faturas de todos os cartões
   */
  async listCreditCardInvoices(
    accountId: string,
    creditCardId?: string,
    monthYear?: string,
  ): Promise<{
    success: boolean;
    invoices?: CreditCardInvoiceRelations[];
  }> {
    try {
      this.logger.log(
        `💳 Listando faturas - accountId: ${accountId}, creditCardId: ${creditCardId || 'ALL'}, monthYear: ${monthYear || 'ALL'}`,
      );

      const payload: any = { accountId };
      if (creditCardId) payload.creditCardId = creditCardId;
      if (monthYear) payload.monthYear = monthYear;

      const result = await this.post<{ success: boolean; invoices: CreditCardInvoiceRelations[] }>(
        '/external/cards/invoices',
        payload,
      );

      if (result.invoices) {
        this.logger.log(`✅ ${result.invoices.length} faturas encontradas`);
      }

      return result;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao listar faturas:`);
      this.logDetailedError(`${this.baseUrl}/external/cards/invoices`, error, {
        AccountId: accountId,
        CreditCardId: creditCardId || 'ALL',
        MonthYear: monthYear || 'ALL',
      });
      return { success: false, invoices: [] };
    }
  }

  /**
   * Paga fatura de cartão de crédito (invoice)
   * Endpoint: POST /external/cards/invoices/pay
   */
  async payInvoice(
    userId: string,
    accountId: string,
    invoiceId: string,
    amount: number,
  ): Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }> {
    try {
      this.logger.log(
        `💳 Pagando invoice ${invoiceId} - accountId: ${accountId}, amount: ${amount}`,
      );

      const body = { accountId, invoiceId, amount, userId };
      const result = await this.post<{ success: boolean; message?: string; error?: string }>(
        '/external/cards/invoices/pay',
        body,
      );

      if (result.success) {
        this.logger.log(`✅ Invoice paga com sucesso: ${invoiceId}`);
      }

      return result;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao pagar invoice:`);
      this.logDetailedError(`${this.baseUrl}/external/cards/invoices/pay`, error);
      return { success: false, error: this.getUserFriendlyError(error) };
    }
  }

  /**
   * Paga fatura de cartão de crédito
   * Endpoint: POST /external/credit-card/invoices/pay
   */
  async payCreditCardInvoice(
    userId: string,
    invoiceId: string,
    bankId: string,
    amount?: number,
    paidAt?: string,
  ): Promise<{
    success: boolean;
    message?: string;
    invoice?: any;
    error?: string;
  }> {
    try {
      this.logger.log(`💳 Pagando fatura ${invoiceId} - userId: ${userId}`);

      // HMAC includes all params (even if undefined)
      const hmacPayload = { userId, invoiceId, bankId, amount, paidAt };
      const body = {
        userId,
        invoiceId,
        bankId,
        ...(amount && { amount }),
        paidAt: paidAt || new Date().toISOString().split('T')[0],
      };

      const result = await this.post<{
        success: boolean;
        message?: string;
        invoice?: any;
        error?: string;
      }>('/external/credit-card/invoices/pay', body, hmacPayload);

      if (result.success) {
        this.logger.log(`✅ Fatura paga: ${invoiceId}`);
      }

      return result;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao pagar fatura:`);
      this.logDetailedError(`${this.baseUrl}/external/credit-card/invoices/pay`, error, {
        UserId: userId,
        InvoiceId: invoiceId,
        BankId: bankId,
      });
      return { success: false, error: this.getUserFriendlyError(error) };
    }
  }
}

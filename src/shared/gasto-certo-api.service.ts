import { Injectable, Logger } from '@nestjs/common';
import {
  CreateUserDto,
  UserDto,
  UserCheckResponseDto,
  RequestAuthCodeDto,
  AuthCodeResponseDto,
  ValidateAuthCodeDto,
  ValidateAuthCodeResponseDto,
  LinkPhoneDto,
  AccountDto,
  SetDefaultAccountDto,
  UserCategoriesResponseDto,
  CategoryDto,
} from './dto/user.dto';
import {
  CreateGastoCertoTransactionDto,
  GastoCertoTransactionResponseDto,
} from '@features/transactions/dto/transaction.dto';
import { MonthlyBalanceRelations } from '../models/monthly-balance.entity';
import { CreditCardResponseDto, ListTransactionsResponseDto } from './types';
import { CreditCardInvoiceRelations } from '@/models/credit-card-invoices.entity';
import { UserAccountApiClient } from './api/user-account-api.client';
import { TransactionApiClient } from './api/transaction-api.client';
import { CreditCardApiClient } from './api/credit-card-api.client';

/**
 * Facade for GastoCerto external API.
 *
 * Delegates all operations to domain-specific API clients:
 * - UserAccountApiClient: User, Auth, Account, Category operations
 * - TransactionApiClient: Transaction, Balance operations
 * - CreditCardApiClient: Credit Card, Invoice operations
 *
 * Consumers inject this class — no changes required at injection sites.
 */
@Injectable()
export class GastoCertoApiService {
  private readonly logger = new Logger(GastoCertoApiService.name);

  constructor(
    private readonly userAccountApi: UserAccountApiClient,
    private readonly transactionApi: TransactionApiClient,
    private readonly creditCardApi: CreditCardApiClient,
  ) {
    this.logger.log(`✅ GastoCertoApiService (facade) inicializado`);
  }

  // ─── User & Auth (delegates to UserAccountApiClient) ───────

  async getUserByPhone(phoneNumber: string): Promise<UserCheckResponseDto> {
    return this.userAccountApi.getUserByPhone(phoneNumber);
  }

  async getUserByEmail(email: string): Promise<UserCheckResponseDto> {
    return this.userAccountApi.getUserByEmail(email);
  }

  async createUser(data: CreateUserDto): Promise<UserDto> {
    return this.userAccountApi.createUser(data);
  }

  async getUserById(userId: string): Promise<UserDto> {
    return this.userAccountApi.getUserById(userId);
  }

  async getSubscriptionStatus(userId: string): Promise<{
    isActive: boolean;
    canUseGastoZap: boolean;
    purchaseUrl?: string;
    message?: string;
  }> {
    return this.userAccountApi.getSubscriptionStatus(userId);
  }

  async requestAuthCode(data: RequestAuthCodeDto): Promise<AuthCodeResponseDto> {
    return this.userAccountApi.requestAuthCode(data);
  }

  async validateAuthCode(data: ValidateAuthCodeDto): Promise<ValidateAuthCodeResponseDto> {
    return this.userAccountApi.validateAuthCode(data);
  }

  async linkPhone(data: LinkPhoneDto): Promise<ValidateAuthCodeResponseDto> {
    return this.userAccountApi.linkPhone(data);
  }

  // ─── Account & Category (delegates to UserAccountApiClient) ─

  async getUserAccounts(userId: string): Promise<AccountDto[]> {
    return this.userAccountApi.getUserAccounts(userId);
  }

  async getUserCategories(userId: string): Promise<UserCategoriesResponseDto> {
    return this.userAccountApi.getUserCategories(userId);
  }

  async setDefaultAccount(
    userId: string,
    data: SetDefaultAccountDto,
  ): Promise<{ success: boolean; message: string; defaultAccount: AccountDto }> {
    return this.userAccountApi.setDefaultAccount(userId, data);
  }

  async getAccountCategories(userId: string, accountId: string): Promise<CategoryDto[]> {
    return this.userAccountApi.getAccountCategories(userId, accountId);
  }

  // ─── Transactions (delegates to TransactionApiClient) ──────

  async createTransaction(
    data: CreateGastoCertoTransactionDto,
  ): Promise<GastoCertoTransactionResponseDto> {
    return this.transactionApi.createTransaction(data);
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
    return this.transactionApi.listTransactions(userId, filters);
  }

  async payTransaction(
    userId: string,
    accountId: string,
    transactionId: string,
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    return this.transactionApi.payTransaction(userId, accountId, transactionId);
  }

  async getPendingBillsByCategory(
    userId: string,
    accountId: string,
    categoryId: string,
  ): Promise<ListTransactionsResponseDto> {
    return this.transactionApi.getPendingBillsByCategory(userId, accountId, categoryId);
  }

  async getPendingPayments(
    userId: string,
    accountId: string,
  ): Promise<ListTransactionsResponseDto> {
    return this.transactionApi.getPendingPayments(userId, accountId);
  }

  // ─── Balance (delegates to TransactionApiClient) ───────────

  async getMonthlySummary(
    accountId: string,
    month?: number,
    year?: number,
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    return this.transactionApi.getMonthlySummary(accountId, month, year);
  }

  async getCategoryBreakdown(
    accountId: string,
    monthReference: string,
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    return this.transactionApi.getCategoryBreakdown(accountId, monthReference);
  }

  async getOverallBalance(
    userId: string,
    accountId: string,
  ): Promise<{
    success: boolean;
    data?: { resume: MonthlyBalanceRelations };
    error?: string;
  }> {
    return this.transactionApi.getOverallBalance(userId, accountId);
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
    return this.transactionApi.getMonthlyBalance(userId, monthYear);
  }

  // ─── Credit Cards (delegates to CreditCardApiClient) ──────

  async listCreditCards(accountId: string): Promise<{
    success: boolean;
    data?: CreditCardResponseDto[];
    error?: string;
  }> {
    return this.creditCardApi.listCreditCards(accountId);
  }

  async getInvoiceDetails(
    accountId: string,
    yearMonth: string,
    creditCardId: string,
  ): Promise<{
    success: boolean;
    invoice?: CreditCardInvoiceRelations;
    error?: string;
  }> {
    return this.creditCardApi.getInvoiceDetails(accountId, yearMonth, creditCardId);
  }

  async listCreditCardInvoices(
    accountId: string,
    creditCardId?: string,
    monthYear?: string,
  ): Promise<{
    success: boolean;
    invoices?: CreditCardInvoiceRelations[];
  }> {
    return this.creditCardApi.listCreditCardInvoices(accountId, creditCardId, monthYear);
  }

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
    return this.creditCardApi.payInvoice(userId, accountId, invoiceId, amount);
  }

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
    return this.creditCardApi.payCreditCardInvoice(userId, invoiceId, bankId, amount, paidAt);
  }
}

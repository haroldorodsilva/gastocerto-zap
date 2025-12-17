import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
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
import { ServiceAuthService } from '@common/services/service-auth.service';

@Injectable()
export class GastoCertoApiService {
  private readonly logger = new Logger(GastoCertoApiService.name);
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly serviceAuthService: ServiceAuthService,
  ) {
    this.baseUrl = this.configService.get<string>('gastoCertoApi.baseUrl')!;
    this.timeout = this.configService.get<number>('gastoCertoApi.timeout', 30000);

    this.logger.log(`✅ GastoCertoApiService inicializado - Base URL: ${this.baseUrl}`);
  }

  /**
   * Busca usuário por número de telefone
   */
  async getUserByPhone(phoneNumber: string): Promise<UserCheckResponseDto> {
    try {
      this.logger.debug(`Buscando usuário por telefone: ${phoneNumber}`);

      const hmacHeaders = this.serviceAuthService.generateAuthHeaders();

      const response = await firstValueFrom(
        this.httpService.get<UserCheckResponseDto>(
          `${this.baseUrl}/external/users/by-phone/${phoneNumber}`,
          {
            headers: {
              ...hmacHeaders,
              'Content-Type': 'application/json',
            },
            timeout: this.timeout,
          },
        ),
      );

      if (response.data.exists && response.data.user) {
        this.logger.log(`✅ Usuário encontrado: ${response.data.user.name}`);
      } else {
        this.logger.debug(`Usuário não encontrado: ${phoneNumber}`);
      }

      return response.data;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao buscar usuário: ${error.message}`);
      throw new HttpException(
        'Erro ao buscar usuário na API Gasto Certo',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Busca usuário por email
   */
  async getUserByEmail(email: string): Promise<UserCheckResponseDto> {
    try {
      this.logger.debug(`Buscando usuário por email: ${email}`);

      const hmacHeaders = this.serviceAuthService.generateAuthHeaders();

      const response = await firstValueFrom(
        this.httpService.get<UserCheckResponseDto>(
          `${this.baseUrl}/external/users/by-email/${email}`,
          {
            headers: {
              ...hmacHeaders,
              'Content-Type': 'application/json',
            },
            timeout: this.timeout,
          },
        ),
      );

      if (response.data.exists && response.data.user) {
        this.logger.log(`✅ Usuário encontrado: ${response.data.user.name}`);
      } else {
        this.logger.debug(`Usuário não encontrado: ${email}`);
      }

      return response.data;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao buscar usuário por email: ${error.message}`);
      throw new HttpException(
        'Erro ao buscar usuário na API Gasto Certo',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Cria novo usuário
   */
  async createUser(data: CreateUserDto): Promise<UserDto> {
    this.logger.log(`Criando usuário: ${data.name} (${data.email})`);

    // Adicionar campos obrigatórios se não foram fornecidos
    const payload = {
      ...data,
      source: data.source || 'telegram',
      acceptedTerms: data.acceptedTerms ?? true,
    };
    try {
      const hmacHeaders = this.serviceAuthService.generateAuthHeaders(payload);

      const response = await firstValueFrom(
        this.httpService.post<{ success: boolean; message: string; user: UserDto }>(
          `${this.baseUrl}/external/users/register`,
          payload,
          {
            headers: {
              ...hmacHeaders,
              'Content-Type': 'application/json',
            },
            timeout: this.timeout,
          },
        ),
      );

      if (!response.data.success || !response.data.user) {
        throw new HttpException(
          response.data.message || 'Erro ao criar usuário',
          HttpStatus.BAD_REQUEST,
        );
      }

      this.logger.log(`✅ Usuário criado com sucesso: ${response.data.user.id}`);

      return response.data.user;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao criar usuário: ${error.message}`, error.response?.data);
      this.logger.error(`❌ Payload: ${payload}`);

      if (error.response?.status === 409) {
        throw new HttpException('Usuário já existe', HttpStatus.CONFLICT);
      }

      if (error.response?.status === 400) {
        throw new HttpException(
          error.response.data?.message || 'Dados inválidos',
          HttpStatus.BAD_REQUEST,
        );
      }

      throw new HttpException(
        'Erro ao criar usuário na API Gasto Certo',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Busca usuário por ID
   */
  async getUserById(userId: string): Promise<UserDto> {
    try {
      this.logger.debug(`Buscando usuário por ID: ${userId}`);

      const hmacHeaders = this.serviceAuthService.generateAuthHeaders();

      const response = await firstValueFrom(
        this.httpService.get<UserDto>(`${this.baseUrl}/external/users/${userId}`, {
          headers: {
            ...hmacHeaders,
            'Content-Type': 'application/json',
          },
          timeout: this.timeout,
        }),
      );

      return response.data;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao buscar usuário por ID: ${error.message}`);

      if (error.response?.status === 404) {
        throw new HttpException('Usuário não encontrado', HttpStatus.NOT_FOUND);
      }

      throw new HttpException(
        'Erro ao buscar usuário na API Gasto Certo',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Verifica se usuário tem assinatura ativa
   */
  async hasActiveSubscription(userId: string): Promise<boolean> {
    try {
      this.logger.debug(`Verificando assinatura do usuário: ${userId}`);

      const hmacHeaders = this.serviceAuthService.generateAuthHeaders();

      const response = await firstValueFrom(
        this.httpService.get<{ isActive: boolean }>(
          `${this.baseUrl}/external/subscriptions/${userId}/status`,
          {
            headers: {
              ...hmacHeaders,
              'Content-Type': 'application/json',
            },
            timeout: this.timeout,
          },
        ),
      );

      return response.data.isActive;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao verificar assinatura: ${error.message}`);

      // Em caso de erro, retornar false (não bloquear usuário)
      return false;
    }
  }

  /**
   * Solicita código de verificação para vincular telefone
   */
  async requestAuthCode(data: RequestAuthCodeDto): Promise<AuthCodeResponseDto> {
    try {
      this.logger.log(`Solicitando código de verificação para: ${data.email}`);

      const hmacHeaders = this.serviceAuthService.generateAuthHeaders(data);

      const response = await firstValueFrom(
        this.httpService.post<AuthCodeResponseDto>(
          `${this.baseUrl}/external/users/auth-code/request`,
          data,
          {
            headers: {
              ...hmacHeaders,
              'Content-Type': 'application/json',
            },
            timeout: this.timeout,
          },
        ),
      );

      if (response.data.success) {
        this.logger.log(`✅ Código enviado para ${data.email}`);
      } else {
        this.logger.warn(`⚠️ Falha ao enviar código: ${response.data.message}`);
      }

      return response.data;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao solicitar código: ${error.message}`, error.response?.data);
      throw new HttpException(
        error.response?.data?.message || 'Erro ao solicitar código de verificação',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Valida código de verificação e vincula telefone
   */
  async validateAuthCode(data: ValidateAuthCodeDto): Promise<ValidateAuthCodeResponseDto> {
    try {
      this.logger.log(`validateAuthCode:: Validando código para: ${data.email}`);

      const hmacHeaders = this.serviceAuthService.generateAuthHeaders(data);

      const response = await firstValueFrom(
        this.httpService.post<ValidateAuthCodeResponseDto>(
          `${this.baseUrl}/external/users/auth-code/validate`,
          data,
          {
            headers: {
              ...hmacHeaders,
              'Content-Type': 'application/json',
            },
            timeout: this.timeout,
          },
        ),
      );
      this.logger.log(`validateAuthCode:: response: ${JSON.stringify(response.data)}`);
      if (response.data.success) {
        this.logger.log(`✅ Telefone vinculado com sucesso para ${data.email}`);
      } else {
        this.logger.warn(`⚠️ Falha na validação: ${response.data.message}`);
      }

      return response.data;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao validar código: ${error.message}`, error.response?.data);
      throw new HttpException(
        error.response?.data?.message || 'Erro ao validar código',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Vincula telefone diretamente (sem verificação)
   */
  async linkPhone(data: LinkPhoneDto): Promise<ValidateAuthCodeResponseDto> {
    try {
      this.logger.log(`Vinculando telefone diretamente para usuário: ${data.userId}`);

      const hmacHeaders = this.serviceAuthService.generateAuthHeaders(data);

      const response = await firstValueFrom(
        this.httpService.post<ValidateAuthCodeResponseDto>(
          `${this.baseUrl}/external/users/link-phone`,
          data,
          {
            headers: {
              ...hmacHeaders,
              'Content-Type': 'application/json',
            },
            timeout: this.timeout,
          },
        ),
      );

      if (response.data.success) {
        this.logger.log(`✅ Telefone vinculado com sucesso`);
      }

      return response.data;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao vincular telefone: ${error.message}`, error.response?.data);
      throw new HttpException(
        error.response?.data?.message || 'Erro ao vincular telefone',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Obtém contas do usuário
   */
  async getUserAccounts(userId: string): Promise<AccountDto[]> {
    try {
      this.logger.debug(`Buscando contas do usuário: ${userId}`);

      const hmacHeaders = this.serviceAuthService.generateAuthHeaders();

      const response = await firstValueFrom(
        this.httpService.get<{ userId: string; accounts: AccountDto[] }>(
          `${this.baseUrl}/external/users/${userId}/accounts`,
          {
            headers: {
              ...hmacHeaders,
              'Content-Type': 'application/json',
            },
            timeout: this.timeout,
          },
        ),
      );

      this.logger.log(`✅ ${response.data.accounts.length} conta(s) encontrada(s)`);
      return response.data.accounts;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao buscar contas: ${error.message}`);
      throw new HttpException('Erro ao buscar contas do usuário', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Obtém todas as contas e categorias do usuário
   */
  async getUserCategories(userId: string): Promise<UserCategoriesResponseDto> {
    try {
      this.logger.debug(`Buscando categorias de todas as contas do usuário: ${userId}`);

      const hmacHeaders = this.serviceAuthService.generateAuthHeaders();

      const response = await firstValueFrom(
        this.httpService.get<UserCategoriesResponseDto>(
          `${this.baseUrl}/external/users/${userId}/categories`,
          {
            headers: {
              ...hmacHeaders,
              'Content-Type': 'application/json',
            },
            timeout: this.timeout,
          },
        ),
      );

      const totalCategories = response.data.accounts.reduce(
        (sum, account) => sum + account.categories.length,
        0,
      );

      this.logger.log(
        `✅ ${response.data.accounts.length} conta(s) encontrada(s) com ${totalCategories} categoria(s) no total`,
      );

      return response.data;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao buscar categorias: ${error.message}`);
      throw new HttpException(
        'Erro ao buscar categorias do usuário',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Define conta padrão do usuário
   */
  async setDefaultAccount(
    userId: string,
    data: SetDefaultAccountDto,
  ): Promise<{ success: boolean; message: string; defaultAccount: AccountDto }> {
    try {
      this.logger.log(`Definindo conta padrão para usuário ${userId}: ${data.accountId}`);

      const hmacHeaders = this.serviceAuthService.generateAuthHeaders(data);

      const response = await firstValueFrom(
        this.httpService.patch<{ success: boolean; message: string; defaultAccount: AccountDto }>(
          `${this.baseUrl}/external/users/${userId}/default-account`,
          data,
          {
            headers: {
              ...hmacHeaders,
              'Content-Type': 'application/json',
            },
            timeout: this.timeout,
          },
        ),
      );

      if (response.data.success) {
        this.logger.log(`✅ Conta padrão atualizada: ${response.data.defaultAccount.name}`);
      }

      return response.data;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao definir conta padrão: ${error.message}`);
      throw new HttpException('Erro ao definir conta padrão', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Busca categorias de uma conta específica
   */
  async getAccountCategories(userId: string, accountId: string): Promise<CategoryDto[]> {
    try {
      this.logger.debug(`Buscando categorias da conta ${accountId} do usuário ${userId}`);

      // Buscar todas as categorias do usuário
      const categoriesResponse = await this.getUserCategories(userId);

      // Encontrar a conta específica
      const account = categoriesResponse.accounts.find((acc) => acc.id === accountId);

      if (!account) {
        this.logger.warn(`⚠️ Conta ${accountId} não encontrada para usuário ${userId}`);
        return [];
      }

      this.logger.log(
        `✅ ${account.categories.length} categoria(s) encontrada(s) na conta ${account.name}`,
      );

      return account.categories;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao buscar categorias da conta: ${error.message}`);
      throw new HttpException(
        'Erro ao buscar categorias da conta',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Cria transação na API Gasto Certo
   */
  async createTransaction(
    data: CreateGastoCertoTransactionDto,
  ): Promise<GastoCertoTransactionResponseDto> {
    try {
      this.logger.log(
        `Criando transação para usuário ${data.userId}: ${data.type} R$ ${data.amount}`,
      );

      const hmacHeaders = this.serviceAuthService.generateAuthHeaders(data);

      const response = await firstValueFrom(
        this.httpService.post<GastoCertoTransactionResponseDto>(
          `${this.baseUrl}/external/transactions`,
          data,
          {
            headers: {
              ...hmacHeaders,
              'Content-Type': 'application/json',
            },
            timeout: this.timeout,
          },
        ),
      );

      if (response.data.success) {
        this.logger.log(`✅ Transação criada com sucesso`);
        return {
          success: true,
        };
      } else if (response.data.error) {
        this.logger.error(
          `❌ Erro ao criar transação: ${response.data.error.code} - ${response.data.error.message}`,
        );
        return {
          success: false,
          error: response.data.error,
        };
      }

      return {
        success: false,
        error: {
          code: 'INVALID_RESPONSE',
          message: 'Resposta inválida da API',
        },
      };
    } catch (error: any) {
      this.logger.error(`❌ Erro ao criar transação: ${error.message}`);

      // Se for erro conhecido da API, retorna o erro estruturado
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

  /**
   * Busca contas pendentes por categoria
   * TODO: Implementar endpoint real na API GastoCerto
   */
  async getPendingBillsByCategory(
    userGastoCertoId: string,
    category: string,
  ): Promise<{ success: boolean; data?: any[]; error?: string }> {
    try {
      this.logger.log(`🧾 [STUB] Buscando contas pendentes da categoria ${category}`);
      // TODO: Implementar chamada real à API
      return {
        success: true,
        data: [],
      };
    } catch (error: any) {
      this.logger.error(`❌ Erro ao buscar contas:`, error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Busca todos os pagamentos pendentes
   * TODO: Implementar endpoint real na API GastoCerto
   */
  async getPendingPayments(
    userGastoCertoId: string,
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      this.logger.log(`📋 [STUB] Buscando pagamentos pendentes`);
      // TODO: Implementar chamada real à API
      return {
        success: true,
        data: {
          total: 0,
          items: [],
        },
      };
    } catch (error: any) {
      this.logger.error(`❌ Erro ao buscar pendentes:`, error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Busca resumo mensal
   * TODO: Implementar endpoint real na API GastoCerto
   */
  async getMonthlySummary(
    userGastoCertoId: string,
    monthReference: string,
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      this.logger.log(`📊 [STUB] Buscando resumo mensal ${monthReference}`);
      // TODO: Implementar chamada real à API
      return {
        success: true,
        data: {
          monthReference,
          totalIncome: 0,
          totalExpense: 0,
          balance: 0,
          topCategories: [],
          transactionCount: 0,
          averagePerDay: 0,
        },
      };
    } catch (error: any) {
      this.logger.error(`❌ Erro ao buscar resumo:`, error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Busca análise por categoria
   * TODO: Implementar endpoint real na API GastoCerto
   */
  async getCategoryBreakdown(
    userGastoCertoId: string,
    monthReference: string,
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      this.logger.log(`📊 [STUB] Buscando análise por categoria ${monthReference}`);
      // TODO: Implementar chamada real à API
      return {
        success: true,
        data: {
          totalExpenses: 0,
          totalIncome: 0,
          expenses: [],
          income: [],
        },
      };
    } catch (error: any) {
      this.logger.error(`❌ Erro ao buscar análise:`, error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Busca balanço geral
   * TODO: Implementar endpoint real na API GastoCerto
   */
  async getOverallBalance(
    userGastoCertoId: string,
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      this.logger.log(`💰 [STUB] Buscando balanço geral`);
      // TODO: Implementar chamada real à API
      return {
        success: true,
        data: {
          totalIncome: 0,
          totalExpenses: 0,
          pendingPayments: 0,
        },
      };
    } catch (error: any) {
      this.logger.error(`❌ Erro ao buscar balanço:`, error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Busca resumo mensal da conta (saldo e movimentações)
   * Endpoint: POST /external/balance/monthly-resume
   */
  async getMonthlyBalance(
    userId: string,
    monthYear?: string, // "2025-12"
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

      const hmacHeaders = this.serviceAuthService.generateAuthHeaders({ userId, monthYear: month });

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/external/balance/monthly-resume`,
          { userId, monthYear: month },
          {
            headers: {
              ...hmacHeaders,
              'Content-Type': 'application/json',
            },
            timeout: this.timeout,
          },
        ),
      );

      if (response.data.success) {
        this.logger.log(`✅ Resumo mensal obtido - Balance: ${response.data.resume.balance}`);
      }

      return response.data;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao buscar resumo mensal:`, error.message);
      return { success: false };
    }
  }

  /**
   * Lista transações com filtros
   * Endpoint: POST /external/transactions/list
   */
  async listTransactions(
    userId: string,
    filters?: {
      monthYear?: string;
      type?: 'INCOME' | 'EXPENSES';
      status?: 'PENDING' | 'PAID';
      categoryId?: string;
      page?: number;
      limit?: number;
    },
  ): Promise<{
    success: boolean;
    transactions?: any[];
    pagination?: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    try {
      this.logger.log(`📋 Listando transações - userId: ${userId}`);

      const hmacHeaders = this.serviceAuthService.generateAuthHeaders({ userId, ...filters });

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/external/transactions/list`,
          {
            userId,
            ...filters,
          },
          {
            headers: {
              ...hmacHeaders,
              'Content-Type': 'application/json',
            },
            timeout: this.timeout,
          },
        ),
      );

      if (response.data.success) {
        this.logger.log(`✅ ${response.data.transactions.length} transações encontradas`);
      }

      return response.data;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao listar transações:`, error.message);
      return {
        success: false,
        transactions: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      };
    }
  }

  /**
   * Marca transação como paga
   * Endpoint: POST /external/transactions/pay
   */
  async payTransaction(
    userId: string,
    transactionId: string,
    paidAt?: string,
  ): Promise<{
    success: boolean;
    message?: string;
    transaction?: any;
    error?: string;
  }> {
    try {
      this.logger.log(`💳 Pagando transação ${transactionId} - userId: ${userId}`);

      const hmacHeaders = this.serviceAuthService.generateAuthHeaders({
        userId,
        transactionId,
        paidAt,
      });

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/external/transactions/pay`,
          {
            userId,
            transactionId,
            paidAt: paidAt || new Date().toISOString().split('T')[0],
          },
          {
            headers: {
              ...hmacHeaders,
              'Content-Type': 'application/json',
            },
            timeout: this.timeout,
          },
        ),
      );

      if (response.data.success) {
        this.logger.log(`✅ Transação paga com sucesso: ${transactionId}`);
      }

      return response.data;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao pagar transação:`, error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Lista cartões de crédito do usuário
   * Endpoint: POST /external/cards
   */
  async listCreditCards(
    accountId: string,
  ): Promise<{
    success: boolean;
    data?: Array<{
      id: string;
      name: string;
      limit: number;
      closingDay: number;
      dueDay: number;
      bankName: string;
      createdAt: string;
    }>;
    error?: string;
  }> {
    try {
      this.logger.log(`💳 Listando cartões - accountId: ${accountId}`);

      const hmacHeaders = this.serviceAuthService.generateAuthHeaders({ accountId });

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/external/cards`,
          { accountId },
          {
            headers: {
              ...hmacHeaders,
              'Content-Type': 'application/json',
            },
            timeout: this.timeout,
          },
        ),
      );

      if (response.data.data) {
        this.logger.log(`✅ ${response.data.data.length} cartão(ões) encontrado(s)`);
      }

      return { success: true, data: response.data.data };
    } catch (error: any) {
      this.logger.error(`❌ Erro ao listar cartões:`, error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Busca detalhes completos de uma fatura de cartão
   * Endpoint: POST /external/cards/invoices/details
   */
  async getInvoiceDetails(
    accountId: string,
    invoiceId: string,
  ): Promise<{
    success: boolean;
    data?: {
      id: string;
      yearMonth: string;
      status: 'OPEN' | 'CLOSED' | 'PAID' | 'OVERDUE';
      closingDate: string;
      dueDate: string;
      grossAmount: number;
      totalAmount: number;
      refundAmount: number;
      advanceAmount: number;
      paidAmount: number;
      creditCardName: string;
      transactions: Array<{
        id: string;
        description: string;
        amount: number;
        date: string;
        type: 'EXPENSES' | 'INCOME';
        categoryName: string;
        subCategoryName?: string;
        note?: string;
      }>;
    };
    error?: string;
  }> {
    try {
      this.logger.log(`💳 Buscando detalhes da fatura ${invoiceId} - accountId: ${accountId}`);

      const hmacHeaders = this.serviceAuthService.generateAuthHeaders({
        accountId,
        invoiceId,
      });

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/external/cards/invoices/details`,
          {
            accountId,
            invoiceId,
          },
          {
            headers: {
              ...hmacHeaders,
              'Content-Type': 'application/json',
            },
            timeout: this.timeout,
          },
        ),
      );

      if (response.data) {
        this.logger.log(
          `✅ Fatura ${invoiceId} - ${response.data.transactions?.length || 0} transação(ões)`,
        );
      }

      return { success: true, data: response.data };
    } catch (error: any) {
      this.logger.error(`❌ Erro ao buscar detalhes da fatura:`, error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Lista faturas de cartão de crédito
   * Endpoint: POST /external/credit-card/invoices/list
   * Nota: Documentação usa /external/cards/invoices mas endpoint real é /external/credit-card/invoices/list
   */
  async listCreditCardInvoices(
    userId: string,
    status?: 'OPEN' | 'CLOSED' | 'PAID' | 'OVERDUE',
  ): Promise<{
    success: boolean;
    invoices?: any[];
  }> {
    try {
      this.logger.log(`💳 Listando faturas - userId: ${userId}, status: ${status || 'ALL'}`);

      const hmacHeaders = this.serviceAuthService.generateAuthHeaders({ userId, status });

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/external/credit-card/invoices/list`,
          {
            userId,
            ...(status && { status }),
          },
          {
            headers: {
              ...hmacHeaders,
              'Content-Type': 'application/json',
            },
            timeout: this.timeout,
          },
        ),
      );

      if (response.data.success) {
        this.logger.log(`✅ ${response.data.invoices.length} faturas encontradas`);
      }

      return response.data;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao listar faturas:`, error.message);
      return { success: false, invoices: [] };
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

      const hmacHeaders = this.serviceAuthService.generateAuthHeaders({
        userId,
        invoiceId,
        bankId,
        amount,
        paidAt,
      });

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/external/credit-card/invoices/pay`,
          {
            userId,
            invoiceId,
            bankId,
            ...(amount && { amount }),
            paidAt: paidAt || new Date().toISOString().split('T')[0],
          },
          {
            headers: {
              ...hmacHeaders,
              'Content-Type': 'application/json',
            },
            timeout: this.timeout,
          },
        ),
      );

      if (response.data.success) {
        this.logger.log(`✅ Fatura paga: ${invoiceId}`);
      }

      return response.data;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao pagar fatura:`, error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

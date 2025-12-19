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
import { DiscordNotificationService } from '@common/services/discord-notification.service';
import { MonthlyBalanceRelations } from '../models/monthly-balance.entity';
import { CreditCardResponseDto, ListTransactionsResponseDto } from './types';
import { CreditCardInvoiceRelations } from '@/models/credit-card-invoices.entity';

@Injectable()
export class GastoCertoApiService {
  private readonly logger = new Logger(GastoCertoApiService.name);
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly serviceAuthService: ServiceAuthService,
    private readonly discordNotification: DiscordNotificationService,
  ) {
    this.baseUrl = this.configService.get<string>('gastoCertoApi.baseUrl')!;
    this.timeout = this.configService.get<number>('gastoCertoApi.timeout', 30000);

    this.logger.log(`✅ GastoCertoApiService inicializado - Base URL: ${this.baseUrl}`);
  }

  /**
   * Método ÚNICO de tratamento de erros da API
   *
   * ⚠️ TODOS os catches devem chamar este método!
   *
   * Responsabilidades:
   * 1. Logar erro técnico completo (para debug)
   * 2. Notificar Discord em erros críticos
   * 3. Retornar mensagem amigável para o usuário
   *
   * @param error - Erro original da requisição
   * @param context - Contexto da operação (ex: "getUserByPhone", "createTransaction")
   * @param metadata - Dados adicionais para debug (phoneNumber, transactionId, etc)
   * @param notifyDiscord - Se deve notificar Discord (padrão: true para erros 5xx)
   */
  private async handleApiError(
    error: any,
    context: string,
    metadata?: Record<string, any>,
    notifyDiscord = true,
  ): Promise<string> {
    // 1. Extrair informações do erro
    const status = error.response?.status;
    const statusText = error.response?.statusText;
    const errorCode = error.code;
    const errorMessage = error.message;
    const responseData = error.response?.data;

    // 2. Log técnico completo (para debug)
    this.logger.error(
      `❌ [${context}] Erro na API GastoCerto:`,
      {
        status,
        statusText,
        errorCode,
        errorMessage,
        responseData,
        metadata,
      },
      error.stack,
    );

    // 3. Verificar se deve notificar Discord
    const shouldNotify =
      notifyDiscord &&
      (status >= 500 || // Erros de servidor
        errorCode === 'ECONNREFUSED' || // Serviço offline
        errorCode === 'ETIMEDOUT' || // Timeout
        errorCode === 'ENOTFOUND'); // DNS não encontrado

    if (shouldNotify) {
      // Notificar Discord de forma assíncrona (não bloqueante)
      this.discordNotification
        .notify({
          title: `🚨 Erro API - ${context}`,
          description: `Falha ao comunicar com API externa do Gasto Certo`,
          color: 'error',
          fields: [
            {
              name: '🔧 Operação',
              value: context,
              inline: true,
            },
            {
              name: '📡 Status HTTP',
              value: status ? `${status} ${statusText}` : errorCode || 'N/A',
              inline: true,
            },
            {
              name: '💾 Dados',
              value: metadata ? JSON.stringify(metadata).substring(0, 500) : 'N/A',
              inline: false,
            },
            {
              name: '❌ Mensagem',
              value: errorMessage || 'Erro desconhecido',
              inline: false,
            },
            {
              name: '📄 Response',
              value: responseData ? JSON.stringify(responseData).substring(0, 500) : 'N/A',
              inline: false,
            },
          ],
        })
        .catch((discordError) => {
          this.logger.warn(`Falha ao notificar Discord: ${discordError.message}`);
        });
    }

    // 4. Retornar mensagem amigável para o usuário
    return this.getUserFriendlyError(error);
  }

  /**
   * Converte erros técnicos em mensagens amigáveis para o usuário
   * ⚠️ NUNCA expor detalhes técnicos como stack traces, códigos HTTP, etc.
   */
  private getUserFriendlyError(error: any): string {
    // Mapear erros HTTP para mensagens amigáveis
    if (error.response?.status === 400) {
      return 'Dados inválidos';
    } else if (error.response?.status === 401 || error.response?.status === 403) {
      return 'Acesso não autorizado';
    } else if (error.response?.status === 404) {
      return 'Recurso não encontrado';
    } else if (error.response?.status === 409) {
      return 'Conflito - recurso já existe';
    } else if (error.response?.status === 422) {
      return 'Dados inválidos ou incompletos';
    } else if (error.response?.status === 500 || error.response?.status === 502) {
      return 'Erro no servidor';
    } else if (error.response?.status === 503) {
      return 'Serviço temporariamente indisponível';
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      return 'Serviço temporariamente indisponível';
    } else if (error.code === 'ETIMEDOUT') {
      return 'Tempo de resposta excedido';
    } else if (error.code === 'ECONNRESET') {
      return 'Conexão interrompida';
    }

    // Mensagem genérica para erros desconhecidos
    return 'Não foi possível processar a solicitação';
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
      const errorMessage = await this.handleApiError(error, 'getUserByPhone', { phoneNumber });
      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
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
      this.logger.error(`❌ Payload: ${JSON.stringify(payload, null, 2)}`);

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
   * Busca contas pendentes de uma categoria específica
   * Usa POST /external/transactions/list com filtros
   */
  async getPendingBillsByCategory(
    userId: string,
    accountId: string,
    categoryId: string,
  ): Promise<ListTransactionsResponseDto> {
    try {
      // Mês/ano atual no formato YYYY-MM
      const now = new Date();
      const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      this.logger.log(
        `🧾 Buscando contas pendentes da categoria ${categoryId} - userId: ${userId}, accountId: ${accountId}, monthYear: ${monthYear}`,
      );

      // Usar listTransactions com filtros de status e categoria
      const result = await this.listTransactions(userId, {
        accountId,
        monthYear,
        status: 'PENDING',
        categoryId,
      });

      if (!result.success) {
        return {
          success: false,
          error: 'Erro ao buscar transações pendentes',
        };
      }

      // FILTRO ADICIONAL: Remover transações que já estão DONE (bug da API retorna DONE mesmo filtrando PENDING)
      if (result.data?.data) {
        const originalCount = result.data.data.length;
        result.data.data = result.data.data.filter((t: any) => t.status !== 'DONE');
        const filteredCount = result.data.data.length;

        if (originalCount !== filteredCount) {
          this.logger.warn(
            `⚠️ Removidas ${originalCount - filteredCount} transações DONE que vieram incorretamente`,
          );
        }
      }

      this.logger.log(
        `✅ ${result.data?.data?.length || 0} contas pendentes da categoria ${categoryId}`,
      );

      return result;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao buscar contas pendentes:`);
      this.logger.error(`   Mensagem: ${error.message}`);
      return {
        success: false,
        error: this.getUserFriendlyError(error),
      };
    }
  }

  /**
   * Busca todos os pagamentos pendentes
   * Endpoint: POST /external/transactions/list com status=PENDING
   * Busca no mês atual (pega pendentes do mês corrente)
   */
  async getPendingPayments(
    userId: string,
    accountId: string,
  ): Promise<ListTransactionsResponseDto> {
    try {
      // Mês/ano atual no formato YYYY-MM
      const now = new Date();
      const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      this.logger.log(
        `[getPendingPayments] 📋 Buscando pagamentos pendentes - userId: ${userId}, accountId: ${accountId}, monthYear: ${monthYear}`,
      );

      // Usar listTransactions com filtro de status PENDING e mês atual
      const result = await this.listTransactions(userId, {
        accountId,
        monthYear,
        status: 'PENDING',
      });

      if (!result.success) {
        return result;
      }

      // FILTRO ADICIONAL: Remover transações que já estão DONE (bug da API retorna DONE mesmo filtrando PENDING)
      if (result.data?.data) {
        const originalCount = result.data.data.length;
        result.data.data = result.data.data.filter((t: any) => t.status !== 'DONE');
        const filteredCount = result.data.data.length;

        if (originalCount !== filteredCount) {
          this.logger.warn(
            `⚠️ Removidas ${originalCount - filteredCount} transações DONE que vieram incorretamente`,
          );
        }
      }

      this.logger.log(
        `[getPendingPayments] ✅ ${result.data?.data?.length || 0} pendentes encontrados`,
      );

      return result;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao buscar pagamentos pendentes:`);
      this.logger.error(`   Mensagem: ${error.message}`);
      return {
        success: false,
        error: this.getUserFriendlyError(error),
      };
    }
  }

  /**
   * Busca resumo mensal
   * Endpoint: POST /external/balance/monthly-resume
   */
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

      const hmacHeaders = this.serviceAuthService.generateAuthHeaders({
        accountId,
        month: targetMonth,
        year: targetYear,
      });

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/external/balance/monthly-resume`,
          {
            accountId,
            month: targetMonth,
            year: targetYear,
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

      this.logger.log(`✅ Resumo mensal obtido com sucesso`);
      return {
        success: true,
        data: response.data,
      };
    } catch (error: any) {
      this.logger.error(`❌ Erro ao buscar resumo mensal:`);
      this.logger.error(`   URL: ${this.baseUrl}/external/balance/monthly-resume`);
      this.logger.error(`   Status HTTP: ${error.response?.status || 'N/A'}`);
      this.logger.error(`   Mensagem: ${error.message}`);
      if (error.response?.data) {
        this.logger.error(`   Resposta da API:`, JSON.stringify(error.response.data));
      }
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        this.logger.error(`   ⚠️  API está OFFLINE ou inacessível`);
      }
      if (error.code === 'ETIMEDOUT') {
        this.logger.error(`   ⚠️  TIMEOUT - API não respondeu em ${this.timeout}ms`);
      }
      return {
        success: false,
        error: this.getUserFriendlyError(error),
      };
    }
  }

  /**
   * Busca análise por categoria
   * Endpoint: POST /external/balance/category-breakdown
   */
  async getCategoryBreakdown(
    accountId: string,
    monthReference: string,
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      this.logger.log(
        `📊 Buscando análise por categoria - accountId: ${accountId}, mês: ${monthReference}`,
      );

      const [year, month] = monthReference.split('-').map(Number);

      const hmacHeaders = this.serviceAuthService.generateAuthHeaders({
        accountId,
        month,
        year,
      });

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/external/balance/category-breakdown`,
          {
            accountId,
            month,
            year,
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

      this.logger.log(`✅ Análise de categorias recebida`);

      return {
        success: true,
        data: response.data,
      };
    } catch (error: any) {
      this.logger.error(`❌ Erro ao buscar análise de categorias:`);
      this.logger.error(`   URL: ${this.baseUrl}/external/balance/category-breakdown`);
      this.logger.error(`   Status HTTP: ${error.response?.status || 'N/A'}`);
      this.logger.error(`   Mensagem: ${error.message}`);
      if (error.response?.data) {
        this.logger.error(`   Resposta da API:`, JSON.stringify(error.response.data));
      }
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        this.logger.error(`   ⚠️ API está OFFLINE ou inacessível`);
      }
      if (error.code === 'ETIMEDOUT') {
        this.logger.error(`   ⚠️ TIMEOUT - API não respondeu em ${this.timeout}ms`);
      }

      return {
        success: false,
        error: this.getUserFriendlyError(error),
      };
    }
  }

  /**
   * Busca balanço geral (resumo do mês atual)
   * Endpoint: POST /external/balance/monthly-resume (sem monthYear = mês atual)
   */
  async getOverallBalance(
    userId: string,
    accountId: string,
  ): Promise<{
    success: boolean;
    data?: {
      resume: MonthlyBalanceRelations;
    };
    error?: string;
  }> {
    try {
      this.logger.log(
        `💰 Buscando balanço geral (mês atual) - userId: ${userId}, accountId: ${accountId}`,
      );

      const hmacHeaders = this.serviceAuthService.generateAuthHeaders({
        userId,
        accountId,
      });

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/external/balance/monthly-resume`,
          { userId, accountId },
          {
            headers: {
              ...hmacHeaders,
              'Content-Type': 'application/json',
            },
            timeout: this.timeout,
          },
        ),
      );

      this.logger.log(
        `✅ Balanço geral recebido - Balance: R$ ${(response.data.balance / 100).toFixed(2)}`,
      );

      return {
        success: true,
        data: response.data,
      };
    } catch (error: any) {
      this.logger.error(`❌ Erro ao buscar balanço geral:`);
      this.logger.error(`   URL: ${this.baseUrl}/external/balance/monthly-resume`);
      this.logger.error(`   Status HTTP: ${error.response?.status || 'N/A'}`);
      this.logger.error(`   Mensagem: ${error.message}`);
      if (error.response?.data) {
        this.logger.error(`   Resposta da API:`, JSON.stringify(error.response.data));
      }
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        this.logger.error(`   ⚠️ API está OFFLINE ou inacessível`);
      }
      if (error.code === 'ETIMEDOUT') {
        this.logger.error(`   ⚠️ TIMEOUT - API não respondeu em ${this.timeout}ms`);
      }

      return {
        success: false,
        error: this.getUserFriendlyError(error),
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
      this.logger.log(`   URL: ${this.baseUrl}/external/transactions/list`);

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
        this.logger.log(
          `✅ Transações listadas com sucesso`,
          JSON.stringify(response.data, null, 2),
        );
        this.logger.log(`✅ ${response.data.data?.data?.length || 0} transações encontradas`);
      }

      return response.data;
    } catch (error: any) {
      if (error.response?.data) {
        this.logger.error(`   Resposta da API:`, JSON.stringify(error.response.data));
      }
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        this.logger.error(`   ⚠️  API está OFFLINE ou inacessível`);
      }
      if (error.code === 'ETIMEDOUT') {
        this.logger.error(`   ⚠️  TIMEOUT - API não respondeu em ${this.timeout}ms`);
      }
      return {
        success: false,
      };
    }
  }

  /**
   * Marca transação como paga
   * Endpoint: POST /external/transactions/pay
   */
  async payTransaction(
    userId: string,
    accountId: string,
    transactionId: string,
  ): Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }> {
    try {
      this.logger.log(
        `💳 Pagando transação ${transactionId} - userId: ${userId} - accountId: ${accountId}`,
      );

      const hmacHeaders = this.serviceAuthService.generateAuthHeaders({
        userId,
        accountId,
        transactionId,
      });

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/external/transactions/pay`,
          {
            userId,
            accountId,
            transactionId,
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
      this.logger.error(`❌ Erro ao pagar transação:`);
      this.logger.error(`   URL: ${this.baseUrl}/external/transactions/pay`);
      this.logger.error(`   Status HTTP: ${error.response?.status || 'N/A'}`);
      this.logger.error(`   Mensagem: ${error.message}`);
      if (error.response?.data) {
        this.logger.error(`   Resposta da API:`, JSON.stringify(error.response.data));
      }
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        this.logger.error(`   ⚠️  API está OFFLINE ou inacessível`);
      }
      if (error.code === 'ETIMEDOUT') {
        this.logger.error(`   ⚠️  TIMEOUT - API não respondeu em ${this.timeout}ms`);
      }

      return {
        success: false,
        error: this.getUserFriendlyError(error),
      };
    }
  }

  /**
   * Lista cartões de crédito do usuário
   * Endpoint: POST /external/cards
   */
  async listCreditCards(accountId: string): Promise<{
    success: boolean;
    data?: CreditCardResponseDto[];
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

      if (response.data.cards) {
        this.logger.log(`✅ ${response.data.cards.length} cartão(ões) encontrado(s)`);
      }

      return { success: true, data: response.data.cards };
    } catch (error: any) {
      if (error.response?.data) {
        this.logger.error(`   Resposta da API:`, JSON.stringify(error.response.data));
      }
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        this.logger.error(`   ⚠️  API está OFFLINE ou inacessível`);
      }
      if (error.code === 'ETIMEDOUT') {
        this.logger.error(`   ⚠️  TIMEOUT - API não respondeu em ${this.timeout}ms`);
      }
      return {
        success: false,
        error: this.getUserFriendlyError(error),
      };
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

      const hmacHeaders = this.serviceAuthService.generateAuthHeaders({
        accountId,
        yearMonth,
        creditCardId,
      });

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/external/cards/invoices/details`,
          {
            accountId,
            yearMonth,
            creditCardId,
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
          `✅ Fatura ${yearMonth} - ${response.data.invoices?.length || 0} transação(ões)`,
        );
      }

      return response.data;
    } catch (error: any) {
      if (error.response?.data) {
        this.logger.error(`   Resposta da API:`, JSON.stringify(error.response.data));
      }
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        this.logger.error(`   ⚠️  API está OFFLINE ou inacessível`);
      }
      if (error.code === 'ETIMEDOUT') {
        this.logger.error(`   ⚠️  TIMEOUT - API não respondeu em ${this.timeout}ms`);
      }
      return {
        success: false,
        error: this.getUserFriendlyError(error),
      };
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

      const hmacHeaders = this.serviceAuthService.generateAuthHeaders(payload);

      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/external/cards/invoices`, payload, {
          headers: {
            ...hmacHeaders,
            'Content-Type': 'application/json',
          },
          timeout: this.timeout,
        }),
      );

      if (response.data.invoices) {
        this.logger.log(`✅ ${response.data.invoices.length} faturas encontradas`);
      }

      return response.data;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao listar faturas:`);
      this.logger.error(`   URL: ${this.baseUrl}/external/cards/invoices`);
      this.logger.error(`   AccountId: ${accountId}`);
      this.logger.error(`   CreditCardId: ${creditCardId || 'ALL'}`);
      this.logger.error(`   MonthYear: ${monthYear || 'ALL'}`);
      this.logger.error(`   Status HTTP: ${error.response?.status || 'N/A'}`);
      this.logger.error(`   Mensagem: ${error.message}`);
      if (error.response?.data) {
        this.logger.error(`   Resposta da API:`, JSON.stringify(error.response.data));
      }
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        this.logger.error(`   ⚠️  API está OFFLINE ou inacessível`);
      }
      if (error.code === 'ETIMEDOUT') {
        this.logger.error(`   ⚠️  TIMEOUT - API não respondeu em ${this.timeout}ms`);
      }
      return { success: false, invoices: [] };
    }
  }

  /**
   * Paga fatura de cartão de crédito (invoice)
   * Endpoint: POST /external/cards/invoices/pay
   *
   * Campos requeridos pela API:
   * - accountId: ID da conta
   * - id: ID da fatura
   * - amount: Valor do pagamento em centavos
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

      const hmacHeaders = this.serviceAuthService.generateAuthHeaders({
        accountId,
        invoiceId,
        amount,
        userId,
      });

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/external/cards/invoices/pay`,
          {
            accountId,
            invoiceId,
            amount,
            userId,
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
        this.logger.log(`✅ Invoice paga com sucesso: ${invoiceId}`);
      }

      return response.data;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao pagar invoice:`);
      this.logger.error(`   URL: ${this.baseUrl}/external/cards/invoices/pay`);
      this.logger.error(`   Status HTTP: ${error.response?.status || 'N/A'}`);
      this.logger.error(`   Mensagem: ${error.message}`);
      if (error.response?.data) {
        this.logger.error(`   Resposta da API:`, JSON.stringify(error.response.data));
      }
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        this.logger.error(`   ⚠️  API está OFFLINE ou inacessível`);
      }
      if (error.code === 'ETIMEDOUT') {
        this.logger.error(`   ⚠️  TIMEOUT - API não respondeu em ${this.timeout}ms`);
      }

      return {
        success: false,
        error: this.getUserFriendlyError(error),
      };
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
      this.logger.error(`❌ Erro ao pagar fatura:`);
      this.logger.error(`   URL: ${this.baseUrl}/external/credit-card/invoices/pay`);
      this.logger.error(`   UserId: ${userId}`);
      this.logger.error(`   InvoiceId: ${invoiceId}`);
      this.logger.error(`   BankId: ${bankId}`);
      this.logger.error(`   Status HTTP: ${error.response?.status || 'N/A'}`);
      this.logger.error(`   Mensagem: ${error.message}`);
      if (error.response?.data) {
        this.logger.error(`   Resposta da API:`, JSON.stringify(error.response.data));
      }
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        this.logger.error(`   ⚠️  API está OFFLINE ou inacessível`);
      }
      if (error.code === 'ETIMEDOUT') {
        this.logger.error(`   ⚠️  TIMEOUT - API não respondeu em ${this.timeout}ms`);
      }
      return {
        success: false,
        error: this.getUserFriendlyError(error),
      };
    }
  }
}

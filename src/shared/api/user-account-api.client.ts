import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { ServiceAuthService } from '@common/services/service-auth.service';
import { DiscordNotificationService } from '@common/services/discord-notification.service';
import { GastoCertoApiClientBase } from './api-client.base';
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
} from '../dto/user.dto';

/**
 * GastoCerto API client for User, Auth, Account, and Category operations.
 *
 * Methods:
 * - getUserByPhone, getUserByEmail, createUser, getUserById
 * - getSubscriptionStatus, hasActiveSubscription
 * - requestAuthCode, validateAuthCode, linkPhone
 * - getUserAccounts, getUserCategories, setDefaultAccount, getAccountCategories
 */
@Injectable()
export class UserAccountApiClient extends GastoCertoApiClientBase {
  constructor(
    configService: ConfigService,
    httpService: HttpService,
    serviceAuthService: ServiceAuthService,
    discordNotification: DiscordNotificationService,
  ) {
    super(
      'UserAccountApiClient',
      configService,
      httpService,
      serviceAuthService,
      discordNotification,
    );
  }

  // ─── User lookup ──────────────────────────────────────────

  async getUserByPhone(phoneNumber: string): Promise<UserCheckResponseDto> {
    try {
      this.logger.debug(`Buscando usuário por telefone: ${phoneNumber}`);

      const result = await this.get<UserCheckResponseDto>(
        `/external/users/by-phone/${phoneNumber}`,
      );

      if (result.exists && result.user) {
        this.logger.log(`✅ Usuário encontrado: ${result.user.name}`);
      } else {
        this.logger.debug(`Usuário não encontrado: ${phoneNumber}`);
      }

      return result;
    } catch (error: any) {
      const errorMessage = await this.handleApiError(error, 'getUserByPhone', { phoneNumber });
      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getUserByEmail(email: string): Promise<UserCheckResponseDto> {
    try {
      this.logger.debug(`Buscando usuário por email: ${email}`);

      const result = await this.get<UserCheckResponseDto>(`/external/users/by-email/${email}`);

      if (result.exists && result.user) {
        this.logger.log(`✅ Usuário encontrado: ${result.user.name}`);
      } else {
        this.logger.debug(`Usuário não encontrado: ${email}`);
      }

      return result;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao buscar usuário por email: ${error.message}`);
      throw new HttpException(
        'Erro ao buscar usuário na API Gasto Certo',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async createUser(data: CreateUserDto): Promise<UserDto> {
    this.logger.log(`Criando usuário: ${data.name} (${data.email})`);

    const payload = {
      ...data,
      source: data.source || 'telegram',
      acceptedTerms: data.acceptedTerms ?? true,
    };

    try {
      const result = await this.post<{ success: boolean; message: string; user: UserDto }>(
        '/external/users/register',
        payload,
      );

      if (!result.success || !result.user) {
        throw new HttpException(result.message || 'Erro ao criar usuário', HttpStatus.BAD_REQUEST);
      }

      this.logger.log(`✅ Usuário criado com sucesso: ${result.user.id}`);
      return result.user;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao criar usuário: ${error.message}`, error.response?.data);
      this.logger.error(`❌ Payload: ${JSON.stringify(payload, null, 2)}`);

      if (error instanceof HttpException) throw error;

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

  async getUserById(userId: string): Promise<UserDto> {
    try {
      this.logger.debug(`Buscando usuário por ID: ${userId}`);

      const result = await this.get<UserDto>(`/external/users/${userId}`);
      return result;
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

  // ─── Subscription ─────────────────────────────────────────

  async getSubscriptionStatus(userId: string): Promise<{
    isActive: boolean;
    canUseGastoZap: boolean;
    purchaseUrl?: string;
    message?: string;
  }> {
    try {
      this.logger.debug(`Verificando status de assinatura completo: ${userId}`);

      const result = await this.get<{
        isActive: boolean;
        canUseGastoZap: boolean;
        purchaseUrl?: string;
        message?: string;
      }>(`/external/subscriptions/${userId}/status`);

      return result;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao verificar status de assinatura: ${error.message}`);

      // Fail-closed: negar acesso em caso de erro para evitar bypass de assinatura
      return {
        isActive: false,
        canUseGastoZap: false,
        message: 'Não foi possível verificar sua assinatura. Tente novamente mais tarde.',
      };
    }
  }

  // ─── Auth ─────────────────────────────────────────────────

  async requestAuthCode(data: RequestAuthCodeDto): Promise<AuthCodeResponseDto> {
    try {
      this.logger.log(`Solicitando código de verificação para: ${JSON.stringify(data)}`);

      const result = await this.post<AuthCodeResponseDto>(
        '/external/users/auth-code/request',
        data,
      );

      if (result.success) {
        this.logger.log(`✅ Código enviado para ${data.email}`);
      } else {
        this.logger.warn(`⚠️ Falha ao enviar código: ${result.message}`);
      }

      return result;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao solicitar código: ${error.message}`, error.response?.data);
      throw new HttpException(
        error.response?.data?.message || 'Erro ao solicitar código de verificação',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async validateAuthCode(data: ValidateAuthCodeDto): Promise<ValidateAuthCodeResponseDto> {
    try {
      this.logger.log(`validateAuthCode:: Validando código para: ${JSON.stringify(data)}`);

      const result = await this.post<ValidateAuthCodeResponseDto>(
        '/external/users/auth-code/validate',
        data,
      );

      this.logger.log(`validateAuthCode:: response: ${JSON.stringify(result)}`);
      if (result.success) {
        this.logger.log(`✅ Telefone vinculado com sucesso para ${data.email}`);
      } else {
        this.logger.warn(`⚠️ Falha na validação: ${result.message}`);
      }

      return result;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao validar código: ${error.message}`, error.response?.data);
      throw new HttpException(
        error.response?.data?.message || 'Erro ao validar código',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async linkPhone(data: LinkPhoneDto): Promise<ValidateAuthCodeResponseDto> {
    try {
      this.logger.log(`Vinculando telefone diretamente para usuário: ${data.userId}`);

      const result = await this.post<ValidateAuthCodeResponseDto>(
        '/external/users/link-phone',
        data,
      );

      if (result.success) {
        this.logger.log(`✅ Telefone vinculado com sucesso`);
      }

      return result;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao vincular telefone: ${error.message}`, error.response?.data);
      throw new HttpException(
        error.response?.data?.message || 'Erro ao vincular telefone',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ─── Accounts & Categories ────────────────────────────────

  async getUserAccounts(userId: string): Promise<AccountDto[]> {
    try {
      this.logger.debug(`Buscando contas do usuário: ${userId}`);

      const result = await this.get<{ userId: string; accounts: AccountDto[] }>(
        `/external/users/${userId}/accounts`,
      );

      this.logger.log(`✅ ${result.accounts.length} conta(s) encontrada(s)`);
      return result.accounts;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao buscar contas: ${error.message}`);
      throw new HttpException('Erro ao buscar contas do usuário', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getUserCategories(userId: string): Promise<UserCategoriesResponseDto> {
    try {
      this.logger.debug(`Buscando categorias de todas as contas do usuário: ${userId}`);

      const result = await this.get<UserCategoriesResponseDto>(
        `/external/users/${userId}/categories`,
      );

      const totalCategories = result.accounts.reduce(
        (sum, account) => sum + account.categories.length,
        0,
      );

      this.logger.log(
        `✅ ${result.accounts.length} conta(s) encontrada(s) com ${totalCategories} categoria(s) no total`,
      );

      return result;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao buscar categorias: ${error.message}`);
      throw new HttpException(
        'Erro ao buscar categorias do usuário',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async setDefaultAccount(
    userId: string,
    data: SetDefaultAccountDto,
  ): Promise<{ success: boolean; message: string; defaultAccount: AccountDto }> {
    try {
      this.logger.log(`Definindo conta padrão para usuário ${userId}: ${data.accountId}`);

      const result = await this.patch<{
        success: boolean;
        message: string;
        defaultAccount: AccountDto;
      }>(`/external/users/${userId}/default-account`, data);

      if (result.success) {
        this.logger.log(`✅ Conta padrão atualizada: ${result.defaultAccount.name}`);
      }

      return result;
    } catch (error: any) {
      this.logger.error(`❌ Erro ao definir conta padrão: ${error.message}`);
      throw new HttpException('Erro ao definir conta padrão', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getAccountCategories(userId: string, accountId: string): Promise<CategoryDto[]> {
    try {
      this.logger.debug(`Buscando categorias da conta ${accountId} do usuário ${userId}`);

      const categoriesResponse = await this.getUserCategories(userId);

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
}

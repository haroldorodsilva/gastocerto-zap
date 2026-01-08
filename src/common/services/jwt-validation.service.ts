import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ServiceAuthService } from './service-auth.service';
import { JwtValidationResponse, AuthenticatedUser } from '../interfaces/jwt.interface';

/**
 * JwtValidationService
 * Valida tokens JWT chamando a API do GastoCerto (gastocerto-api)
 * Usa autenticação HMAC para comunicação service-to-service
 */
@Injectable()
export class JwtValidationService {
  private readonly logger = new Logger(JwtValidationService.name);
  private readonly apiUrl: string;
  private readonly timeout: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly serviceAuthService: ServiceAuthService,
  ) {
    this.apiUrl = this.configService.get<string>('gastoCertoApi.baseUrl')!;
    this.timeout = this.configService.get<number>('gastoCertoApi.timeout') || 30000;
  }

  /**
   * Valida JWT token chamando gastocerto-api
   * @param token - JWT token do Authorization header
   * @returns Dados do usuário autenticado ou null
   */
  async validateToken(token: string): Promise<AuthenticatedUser | null> {
    try {
      this.logger.debug('Validating JWT token via gastocerto-api');

      // Gera headers HMAC para autenticação service-to-service
      const body = { token };
      const hmacHeaders = this.serviceAuthService.generateAuthHeaders(body);

      this.logger.log(
        JSON.stringify({
          url: `${this.apiUrl}/external/auth/validate-token`,
          body,
          params: {
            headers: {
              'Content-Type': 'application/json',
              ...hmacHeaders,
            },
            timeout: this.timeout,
          },
        }),
      );

      // Chama endpoint de validação na API
      const response = await axios.post<JwtValidationResponse>(
        `${this.apiUrl}/external/auth/validate-token`,
        body,
        {
          headers: {
            'Content-Type': 'application/json',
            ...hmacHeaders,
          },
          timeout: this.timeout,
        },
      );

      // Log da resposta da API
      this.logger.log(
        `[validate-token] Response: ${JSON.stringify({
          status: response.status,
          valid: response.data.valid,
          payload: response.data.payload,
        })}`,
      );

      if (!response.data.valid || !response.data.payload) {
        this.logger.warn('Invalid token response from API');
        return null;
      }

      const { payload } = response.data;

      // Busca dados completos do usuário
      this.logger.debug(`Fetching user data for: ${payload.sub}`);
      const user = await this.getUserById(payload.sub);

      if (!user) {
        this.logger.warn(`User not found: ${payload.sub}`);
        return null;
      }

      this.logger.log(
        `[getUserById] Response: ${JSON.stringify({
          userId: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        })}`,
      );

      // Valida role
      if (!['ADMIN', 'MASTER'].includes(user.role)) {
        this.logger.warn(`User ${user.id} does not have admin privileges (role: ${user.role})`);
        return null;
      }

      this.logger.log(`✅ JWT validated: ${user.email} (${user.role})`);
      return user;
    } catch (error: any) {
      if (error.response) {
        this.logger.error(
          `API returned error: ${error.response.status} - ${error.response.data?.message || 'Unknown'}`,
        );
      } else if (error.code === 'ECONNREFUSED') {
        this.logger.error(
          `❌ Cannot connect to gastocerto-api at ${this.apiUrl}\n` +
            `   💡 Make sure gastocerto-api is running or update GASTO_CERTO_API_URL in .env`,
        );
      } else {
        this.logger.error(`Error validating token: ${error.message}`);
      }
      return null;
    }
  }

  /**
   * Valida JWT token chamando gastocerto-api (aceita qualquer role)
   * @param token - JWT token do Authorization header
   * @returns Dados do usuário autenticado ou null
   */
  async validateTokenAnyRole(token: string): Promise<AuthenticatedUser | null> {
    try {
      this.logger.debug('Validating JWT token via gastocerto-api (any role)');

      // Gera headers HMAC para autenticação service-to-service
      const body = { token };
      const hmacHeaders = this.serviceAuthService.generateAuthHeaders(body);

      // Chama endpoint de validação na API
      const response = await axios.post<JwtValidationResponse>(
        `${this.apiUrl}/external/auth/validate-token`,
        body,
        {
          headers: {
            'Content-Type': 'application/json',
            ...hmacHeaders,
          },
          timeout: this.timeout,
        },
      );

      if (!response.data.valid || !response.data.payload) {
        this.logger.warn('Invalid token response from API');
        return null;
      }

      const { payload } = response.data;

      // Busca dados completos do usuário
      this.logger.debug(`Fetching user data for: ${payload.sub}`);
      const user = await this.getUserById(payload.sub);

      if (!user) {
        this.logger.warn(`User not found: ${payload.sub}`);
        return null;
      }

      this.logger.log(`✅ JWT validated (any role): ${user.email} (${user.role})`);
      return user;
    } catch (error: any) {
      if (error.response) {
        this.logger.error(
          `API returned error: ${error.response.status} - ${error.response.data?.message || 'Unknown'}`,
        );
      } else if (error.code === 'ECONNREFUSED') {
        this.logger.error(
          `❌ Cannot connect to gastocerto-api at ${this.apiUrl}\n` +
            `   💡 Make sure gastocerto-api is running or update GASTO_CERTO_API_URL in .env`,
        );
      } else {
        this.logger.error(`Error validating token: ${error.message}`);
      }
      return null;
    }
  }

  /**
   * Busca dados completos do usuário por ID
   */
  private async getUserById(userId: string): Promise<AuthenticatedUser | null> {
    try {
      const hmacHeaders = this.serviceAuthService.generateAuthHeaders();

      this.logger.log(
        `[getUserById] Request: ${JSON.stringify({
          url: `${this.apiUrl}/external/users/${userId}`,
          headers: hmacHeaders,
        })}`,
      );

      const response = await axios.get<AuthenticatedUser>(
        `${this.apiUrl}/external/users/${userId}`,
        {
          headers: hmacHeaders,
          timeout: this.timeout,
        },
      );

      this.logger.log(
        `[getUserById] Response status: ${response.status}, data: ${JSON.stringify(response.data)}`,
      );

      return response.data;
    } catch (error: any) {
      this.logger.error(`Error fetching user ${userId}: ${error.message}`);
      if (error.response) {
        this.logger.error(`Response error: ${JSON.stringify(error.response.data)}`);
      }
      return null;
    }
  }

  /**
   * Extrai token do Authorization header
   * @param authHeader - "Bearer eyJhbGc..."
   * @returns Token sem o prefixo "Bearer "
   */
  extractTokenFromHeader(authHeader?: string): string | null {
    if (!authHeader) {
      return null;
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return null;
    }

    return parts[1];
  }
}

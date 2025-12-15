import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PhoneFormatterUtil } from '@core/utils/phone-formatter.util';

/**
 * Guard que valida se a mensagem vem do telefone de teste configurado.
 * Útil para desenvolvimento e testes.
 *
 * Se TEST_PHONE_NUMBER não estiver configurado, permite todas as mensagens.
 * Se configurado, apenas o número especificado pode enviar mensagens.
 */
@Injectable()
export class TestPhoneGuard implements CanActivate {
  private readonly logger = new Logger(TestPhoneGuard.name);
  private readonly testPhoneNumber: string | undefined;

  constructor(private configService: ConfigService) {
    this.testPhoneNumber = this.configService.get<string>('TEST_PHONE_NUMBER');

    if (this.testPhoneNumber) {
      this.logger.warn(
        `⚠️  TEST_PHONE_NUMBER está configurado: apenas ${this.testPhoneNumber} pode enviar mensagens`,
      );
    } else {
      this.logger.log('✅ TEST_PHONE_NUMBER não configurado - aceitando mensagens de todos os números');
    }
  }

  canActivate(context: ExecutionContext): boolean {
    // Se não há número de teste configurado, permitir todos
    if (!this.testPhoneNumber) {
      return true;
    }

    // Extrair dados do contexto
    const data = this.getDataFromContext(context);
    if (!data || !data.phoneNumber) {
      this.logger.warn('Mensagem sem phoneNumber - bloqueada');
      return false;
    }

    const incomingPhone = data.phoneNumber;

    // Normalizar números para comparação
    const normalizedTest = PhoneFormatterUtil.normalize(this.testPhoneNumber);
    const normalizedIncoming = PhoneFormatterUtil.normalize(incomingPhone);

    // Comparar
    if (normalizedIncoming !== normalizedTest) {
      this.logger.debug(
        `❌ Mensagem bloqueada de ${incomingPhone} (apenas ${this.testPhoneNumber} permitido)`,
      );
      return false;
    }

    this.logger.debug(`✅ Mensagem permitida de ${incomingPhone} (telefone de teste)`);
    return true;
  }

  /**
   * Extrai dados do contexto (HTTP, WebSocket, etc)
   */
  private getDataFromContext(context: ExecutionContext): any {
    const type = context.getType();

    if (type === 'http') {
      const request = context.switchToHttp().getRequest();
      return request.body || request.query || request.params;
    }

    if (type === 'ws') {
      return context.switchToWs().getData();
    }

    if (type === 'rpc') {
      return context.switchToRpc().getData();
    }

    return null;
  }
}

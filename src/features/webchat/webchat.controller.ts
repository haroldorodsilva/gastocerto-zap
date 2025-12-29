import { Controller, Post, Body, Logger } from '@nestjs/common';
import { WebChatService } from './webchat.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

// DTO para mensagem do chat web
class SendWebChatMessageDto {
  message: string;
  userId: string; // ID do usuário no GastoCerto (já autenticado no frontend)
}

// DTO de resposta estruturada
export interface WebChatResponse {
  success: boolean;
  messageType: 'transaction' | 'confirmation' | 'learning' | 'info' | 'error';
  message: string;
  data?: {
    transactionId?: string;
    amount?: number;
    category?: string;
    description?: string;
    date?: string;
    requiresConfirmation?: boolean;
    confirmationId?: string;
    learningOptions?: Array<{
      id: number;
      text: string;
      category: string;
    }>;
  };
  formatting?: {
    highlight?: string[]; // Partes do texto para destacar
    emoji?: string; // Emoji principal da resposta
    color?: 'success' | 'warning' | 'info' | 'error';
  };
}

@ApiTags('Web Chat')
@Controller('webchat')
export class WebChatController {
  private readonly logger = new Logger(WebChatController.name);

  constructor(private readonly webChatService: WebChatService) {}

  @Post('message')
  @ApiOperation({
    summary: 'Enviar mensagem no chat web',
    description: 'Processa mensagem do usuário usando o mesmo fluxo do WhatsApp/Telegram',
  })
  @ApiResponse({
    status: 200,
    description: 'Mensagem processada com sucesso',
    type: Object,
  })
  async sendMessage(@Body() dto: SendWebChatMessageDto): Promise<WebChatResponse> {
    this.logger.log(
      `📱 [WebChat] Mensagem recebida do usuário ${dto.userId}: "${dto.message.substring(0, 50)}..."`,
    );

    try {
      const result = await this.webChatService.processMessage(dto.userId, dto.message);

      this.logger.log(
        `✅ [WebChat] Mensagem processada: ${result.messageType} - ${result.success}`,
      );

      return result;
    } catch (error) {
      this.logger.error(`❌ [WebChat] Erro ao processar mensagem do usuário ${dto.userId}:`, error);

      return {
        success: false,
        messageType: 'error',
        message: '❌ Ops! Ocorreu um erro ao processar sua mensagem. Tente novamente.',
        formatting: {
          emoji: '❌',
          color: 'error',
        },
      };
    }
  }
}

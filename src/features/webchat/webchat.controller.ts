import {
  Controller,
  Post,
  Body,
  Logger,
  UseGuards,
  Req,
  Headers,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsString, IsNotEmpty } from 'class-validator';
import { Request } from 'express';
import { WebChatService } from './webchat.service';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiProperty,
  ApiBearerAuth,
  ApiHeader,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '@common/interfaces/jwt.interface';
import { UploadFileDto, UploadResponse } from './dto/upload.dto';
import type { Multer } from 'multer';

// DTO para mensagem do chat web
export class SendWebChatMessageDto {
  @ApiProperty({
    description: 'Mensagem de texto enviada pelo usuário',
    example: 'Gastei 50 reais no supermercado',
  })
  @IsString()
  @IsNotEmpty()
  message: string;
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
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class WebChatController {
  private readonly logger = new Logger(WebChatController.name);

  constructor(private readonly webChatService: WebChatService) {}

  @Post('message')
  @ApiOperation({
    summary: 'Enviar mensagem no chat web',
    description:
      'Processa mensagem do usuário usando o mesmo fluxo do WhatsApp/Telegram. Requer autenticação JWT.',
  })
  @ApiHeader({
    name: 'x-account',
    description: 'ID da conta/perfil ativo (accountId)',
    required: false,
    example: 'e71f3d31-5de2-4c36-ac4e-7e9fc9c2b08b',
  })
  @ApiResponse({
    status: 200,
    description: 'Mensagem processada com sucesso',
    type: Object,
  })
  @ApiResponse({
    status: 401,
    description: 'Não autenticado - JWT inválido ou ausente',
  })
  async sendMessage(
    @Body() dto: SendWebChatMessageDto,
    @Req() req: Request,
    @Headers('x-account') accountId?: string,
  ): Promise<WebChatResponse> {
    // Extrai userId do JWT (adicionado pelo JwtAuthGuard)
    const user = (req as any).user as AuthenticatedUser;
    const userId = user.id;

    this.logger.log(
      `📱 [WebChat] Mensagem recebida - userId: ${userId}, accountId: ${accountId || 'default'}, message: "${dto.message.substring(0, 50)}..."`,
    );

    try {
      const result = await this.webChatService.processMessage(userId, dto.message, accountId);

      this.logger.log(
        `✅ [WebChat] Mensagem processada: ${result.messageType} - ${result.success}`,
      );

      return result;
    } catch (error) {
      this.logger.error(`❌ [WebChat] Erro ao processar mensagem do usuário ${userId}:`, error);

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

  @Post('upload/image')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload de imagem (nota fiscal, comprovante)',
    description:
      'Envia uma imagem para processamento. O sistema tentará extrair informações via OCR e processar como transação.',
  })
  @ApiHeader({
    name: 'x-account',
    description: 'ID da conta/perfil ativo (accountId)',
    required: false,
    example: 'e71f3d31-5de2-4c36-ac4e-7e9fc9c2b08b',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Arquivo de imagem (jpg, png, pdf)',
        },
        message: {
          type: 'string',
          description: 'Mensagem de contexto adicional (opcional)',
          example: 'Nota fiscal do supermercado',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Imagem processada com sucesso',
  })
  @ApiResponse({
    status: 400,
    description: 'Arquivo inválido ou ausente',
  })
  @ApiResponse({
    status: 401,
    description: 'Não autenticado',
  })
  async uploadImage(
    @UploadedFile() file: Multer.File,
    @Body() dto: UploadFileDto,
    @Req() req: Request,
    @Headers('x-account') accountId?: string,
  ): Promise<UploadResponse> {
    const user = (req as any).user as AuthenticatedUser;
    const userId = user.id;

    if (!file) {
      throw new BadRequestException('Nenhum arquivo foi enviado');
    }

    // Validar tipo de arquivo
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Tipo de arquivo não suportado. Use: JPG, PNG ou PDF',
      );
    }

    // Validar tamanho (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      throw new BadRequestException('Arquivo muito grande. Tamanho máximo: 10MB');
    }

    this.logger.log(
      `📷 [WebChat] Imagem recebida - userId: ${userId}, fileName: ${file.originalname}, size: ${file.size} bytes`,
    );

    try {
      const result = await this.webChatService.processImageUpload(
        userId,
        file,
        dto.message,
        accountId,
      );

      this.logger.log(`✅ [WebChat] Imagem processada: ${result.success}`);
      return result;
    } catch (error) {
      this.logger.error(`❌ [WebChat] Erro ao processar imagem do usuário ${userId}:`, error);

      return {
        success: false,
        messageType: 'error',
        message: 'Erro ao processar imagem. Tente novamente.',
        formatting: {
          color: 'error',
        },
      };
    }
  }

  @Post('upload/audio')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload de áudio (mensagem de voz)',
    description:
      'Envia um áudio para transcrição. O sistema converterá o áudio em texto e processará como mensagem.',
  })
  @ApiHeader({
    name: 'x-account',
    description: 'ID da conta/perfil ativo (accountId)',
    required: false,
    example: 'e71f3d31-5de2-4c36-ac4e-7e9fc9c2b08b',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Arquivo de áudio (mp3, ogg, wav, m4a)',
        },
        message: {
          type: 'string',
          description: 'Mensagem de contexto adicional (opcional)',
          example: 'Gravei minhas despesas do dia',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Áudio processado com sucesso',
  })
  @ApiResponse({
    status: 400,
    description: 'Arquivo inválido ou ausente',
  })
  @ApiResponse({
    status: 401,
    description: 'Não autenticado',
  })
  async uploadAudio(
    @UploadedFile() file: Multer.File,
    @Body() dto: UploadFileDto,
    @Req() req: Request,
    @Headers('x-account') accountId?: string,
  ): Promise<UploadResponse> {
    const user = (req as any).user as AuthenticatedUser;
    const userId = user.id;

    if (!file) {
      throw new BadRequestException('Nenhum arquivo foi enviado');
    }

    // Validar tipo de arquivo
    const allowedMimeTypes = [
      'audio/mpeg',
      'audio/mp3',
      'audio/ogg',
      'audio/wav',
      'audio/x-m4a',
      'audio/m4a',
    ];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Tipo de arquivo não suportado. Use: MP3, OGG, WAV ou M4A',
      );
    }

    // Validar tamanho (max 20MB)
    const maxSize = 20 * 1024 * 1024; // 20MB
    if (file.size > maxSize) {
      throw new BadRequestException('Arquivo muito grande. Tamanho máximo: 20MB');
    }

    this.logger.log(
      `🎤 [WebChat] Áudio recebido - userId: ${userId}, fileName: ${file.originalname}, size: ${file.size} bytes`,
    );

    try {
      const result = await this.webChatService.processAudioUpload(
        userId,
        file,
        dto.message,
        accountId,
      );

      this.logger.log(`✅ [WebChat] Áudio processado: ${result.success}`);
      return result;
    } catch (error) {
      this.logger.error(`❌ [WebChat] Erro ao processar áudio do usuário ${userId}:`, error);

      return {
        success: false,
        messageType: 'error',
        message: 'Erro ao processar áudio. Tente novamente.',
        formatting: {
          color: 'error',
        },
      };
    }
  }
}

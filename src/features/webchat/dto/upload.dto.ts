import { IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO para upload de arquivo (imagem ou áudio)
 */
export class UploadFileDto {
  @ApiProperty({
    description: 'Mensagem de texto adicional (opcional) para auxiliar no contexto',
    example: 'Nota fiscal do supermercado',
    required: false,
  })
  @IsString()
  @IsOptional()
  message?: string;
}

/**
 * Interface para resposta de upload
 */
export interface UploadResponse {
  success: boolean;
  messageType: 'transaction' | 'confirmation' | 'learning' | 'info' | 'error';
  message: string;
  data?: {
    fileUrl?: string;
    fileName?: string;
    fileSize?: number;
    processedText?: string; // Texto extraído (OCR ou transcrição)
    transactionId?: string; // ID da transação criada
    amount?: number;
    category?: string;
    description?: string;
    date?: string;
    requiresConfirmation?: boolean;
    confirmationId?: string;
  };
  formatting?: {
    color: 'success' | 'warning' | 'info' | 'error';
    highlight?: string[];
  };
}

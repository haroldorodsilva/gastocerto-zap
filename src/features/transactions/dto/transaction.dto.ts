import { IsString, IsNumber, IsEnum, IsOptional, IsDate, IsUUID, IsBoolean } from 'class-validator';
import { TransactionType, ConfirmationStatus } from '@prisma/client';

/**
 * DTO para criar confirmação de transação
 */
export class CreateTransactionConfirmationDto {
  @IsString()
  phoneNumber: string;

  @IsString()
  @IsOptional()
  userId?: string; // ID do UserCache - relação com usuário

  @IsString()
  messageId: string;

  @IsEnum(TransactionType)
  type: TransactionType;

  @IsNumber()
  amount: number;

  @IsString()
  category: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsDate()
  @IsOptional()
  date?: Date;

  @IsOptional()
  extractedData?: any; // Dados brutos da IA
}

/**
 * DTO de resposta de confirmação
 */
export class TransactionConfirmationResponseDto {
  @IsUUID()
  id: string;

  @IsString()
  phoneNumber: string;

  @IsEnum(TransactionType)
  type: TransactionType;

  @IsNumber()
  amount: number;

  @IsString()
  category: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsDate()
  @IsOptional()
  date?: Date;

  @IsEnum(ConfirmationStatus)
  status: ConfirmationStatus;

  @IsDate()
  createdAt: Date;

  @IsDate()
  expiresAt: Date;
}

/**
 * DTO para processar confirmação
 */
export class ProcessConfirmationDto {
  @IsString()
  phoneNumber: string;

  @IsString()
  response: string; // "sim" ou "não"
}

/**
 * DTO para criar transação na API Gasto Certo
 */
export class CreateGastoCertoTransactionDto {
  @IsString()
  userId: string;

  @IsUUID()
  @IsOptional()
  accountId?: string; // ID da conta (usa default se não informado)

  @IsEnum(TransactionType)
  type: TransactionType;

  @IsNumber()
  amount: number;

  @IsUUID()
  categoryId: string;

  @IsUUID()
  @IsOptional()
  subCategoryId?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  date?: string; // ISO 8601 format

  @IsString()
  @IsOptional()
  merchant?: string;

  @IsString()
  source: string; // 'whatsapp' | 'telegram'

  @IsBoolean()
  @IsOptional()
  isCreditCard?: boolean; // false = banco, true = cartão de crédito
}

/**
 * DTO de resposta da API Gasto Certo
 */
export class GastoCertoTransactionResponseDto {
  @IsBoolean()
  success: boolean;

  @IsString()
  message: string;

  @IsOptional()
  transaction?: {
    id: string;
    userId: string;
    type: TransactionType;
    amount: number;
    description?: string;
    date: string;
    categoryId: string;
    categoryName: string;
    subCategoryId?: string;
    subCategoryName?: string;
    accountId: string;
    bankId?: string;
    creditCardId?: string;
    source: string;
    createdAt: string;
  };

  @IsOptional()
  error?: {
    code: string; // USER_NOT_FOUND, NO_ACCOUNT, INVALID_CATEGORY, etc.
    message: string;
  };
}

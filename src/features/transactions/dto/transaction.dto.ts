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
  platform?: string; // Plataforma: whatsapp | telegram

  @IsString()
  @IsOptional()
  userId?: string; // ID do UserCache - relação com usuário

  @IsString()
  @IsOptional()
  accountId?: string; // ID da conta ativa no momento da transação

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
  categoryId?: string; // ID da categoria resolvida

  @IsString()
  @IsOptional()
  subCategoryId?: string; // ID da subcategoria resolvida

  @IsString()
  @IsOptional()
  subCategoryName?: string; // Nome da subcategoria (para exibir)

  @IsString()
  @IsOptional()
  description?: string;

  @IsDate()
  @IsOptional()
  date?: Date;

  @IsOptional()
  extractedData?: any; // Dados brutos da IA

  // ✨ NOVOS CAMPOS - Transações Avançadas
  @IsBoolean()
  @IsOptional()
  isFixed?: boolean; // Transação recorrente/fixa

  @IsString()
  @IsOptional()
  fixedFrequency?: 'MONTHLY' | 'WEEKLY' | 'ANNUAL' | 'BIENNIAL'; // Frequência da recorrência

  @IsNumber()
  @IsOptional()
  installments?: number; // Número total de parcelas

  @IsNumber()
  @IsOptional()
  installmentNumber?: number; // Número da parcela atual (1, 2, 3...)

  @IsString()
  @IsOptional()
  creditCardId?: string; // ID do cartão de crédito usado

  @IsString()
  @IsOptional()
  paymentStatus?: 'PENDING' | 'DONE'; // Status de pagamento

  @IsString()
  @IsOptional()
  invoiceMonth?: string; // Mês da fatura (YYYY-MM) para cartão de crédito
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
  accountId: string; // ID da conta (agora obrigatório)

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

  @IsString()
  @IsOptional()
  observation?: string; // Observações adicionais
}

/**
 * DTO de resposta da API Gasto Certo
 */
export class GastoCertoTransactionResponseDto {
  @IsBoolean()
  success: boolean;

  @IsString()
  @IsOptional()
  message?: string;

  @IsOptional()
  transaction?: {
    id: string;
    [key: string]: any;
  };

  @IsOptional()
  error?: {
    code: string; // USER_NOT_FOUND, NO_ACCOUNT, INVALID_CATEGORY, etc.
    message: string;
  };
}

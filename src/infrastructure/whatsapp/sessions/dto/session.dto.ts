import { IsString, IsBoolean, IsOptional, IsEnum } from 'class-validator';
import { SessionStatus } from '@prisma/client';

/**
 * DTO para criar nova sessão
 */
export class CreateSessionDto {
  @IsString()
  @IsOptional()
  sessionId?: string;

  @IsString()
  @IsOptional()
  phoneNumber?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  token?: string; // Token do bot Telegram (apenas para Telegram)
}

/**
 * DTO para atualizar sessão
 */
export class UpdateSessionDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsEnum(SessionStatus)
  @IsOptional()
  status?: SessionStatus;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsString()
  @IsOptional()
  token?: string; // Permite atualizar token em sessões existentes
}

/**
 * DTO de resposta de sessão
 */
export class SessionResponseDto {
  id: string;
  sessionId: string;
  phoneNumber: string;
  name?: string;
  status: SessionStatus;
  isActive: boolean;
  lastSeen?: Date;
  qrCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * DTO para filtro de listagem
 */
export class ListSessionsQueryDto {
  @IsEnum(SessionStatus)
  @IsOptional()
  status?: SessionStatus;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsString()
  @IsOptional()
  search?: string;
}

/**
 * DTO para criar sessão Telegram
 */
export class CreateTelegramSessionDto {
  @IsString()
  name: string;

  @IsString()
  token: string; // Token do bot obtido via @BotFather
}

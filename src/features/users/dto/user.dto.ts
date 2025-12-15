import {
  IsString,
  IsEmail,
  IsUUID,
  IsBoolean,
  IsOptional,
  IsObject,
  IsArray,
  IsNumber,
  IsDateString,
} from 'class-validator';

/**
 * DTO para criar usuário na API Gasto Certo
 */
export class CreateUserDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  phoneNumber: string;

  @IsString()
  @IsOptional()
  source?: string;

  @IsBoolean()
  @IsOptional()
  acceptedTerms?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

/**
 * DTO para verificação de usuário
 */
export class UserCheckResponseDto {
  @IsBoolean()
  exists: boolean;

  @IsOptional()
  user?: UserDto | null;
}

/**
 * DTO para solicitar código de autenticação
 */
export class RequestAuthCodeDto {
  @IsEmail()
  email: string;

  @IsString()
  phoneNumber: string;

  @IsString()
  source: 'whatsapp' | 'telegram';
}

/**
 * DTO de resposta ao solicitar código
 */
export class AuthCodeResponseDto {
  @IsBoolean()
  success: boolean;

  @IsString()
  message: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsNumber()
  attemptsRemaining?: number;

  @IsOptional()
  @IsDateString()
  canRetryAt?: string;
}

/**
 * DTO para validar código de autenticação
 */
export class ValidateAuthCodeDto {
  @IsEmail()
  email: string;

  @IsString()
  code: string;

  @IsString()
  phoneNumber: string;
}

/**
 * DTO de resposta ao validar código
 */
export class ValidateAuthCodeResponseDto {
  @IsBoolean()
  success: boolean;

  @IsString()
  message: string;

  @IsOptional()
  user?: UserDto;

  @IsOptional()
  @IsNumber()
  attemptsRemaining?: number;

  @IsOptional()
  @IsDateString()
  canRetryAt?: string;
}

/**
 * DTO para vincular telefone direto
 */
export class LinkPhoneDto {
  @IsUUID()
  userId: string;

  @IsString()
  phoneNumber: string;
}

/**
 * DTO de conta do usuário
 */
export class AccountDto {
  @IsUUID()
  id: string;

  @IsString()
  name: string;

  @IsString()
  role: string;

  @IsBoolean()
  isPrimary: boolean;

  @IsBoolean()
  isCreator: boolean;

  @IsOptional()
  @IsDateString()
  createdAt?: string;
}

/**
 * DTO para definir conta padrão
 */
export class SetDefaultAccountDto {
  @IsUUID()
  accountId: string;
}

/**
 * DTO de resposta da API Gasto Certo
 */
export class UserDto {
  @IsUUID()
  id: string;

  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @IsOptional()
  phoneNumber?: string;

  @IsBoolean()
  @IsOptional()
  hasActiveSubscription?: boolean;

  @IsBoolean()
  @IsOptional()
  isBlocked?: boolean;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsString()
  @IsOptional()
  role?: string;

  @IsString()
  @IsOptional()
  avatar?: string;

  @IsDateString()
  @IsOptional()
  createdAt?: string;

  @IsArray()
  @IsOptional()
  accounts?: AccountDto[];

  @IsOptional()
  categories?: CategoryDto[];

  @IsOptional()
  preferences?: Record<string, any>;

  @IsString()
  @IsOptional()
  updatedAt?: string;
}

/**
 * DTO de subcategoria
 */
export class SubCategoryDto {
  @IsUUID()
  id: string;

  @IsString()
  name: string;
}

/**
 * DTO de categoria
 */
export class CategoryDto {
  @IsUUID()
  id: string;

  @IsString()
  name: string;

  @IsString()
  type: 'EXPENSES' | 'INCOME';

  @IsArray()
  @IsOptional()
  subCategories?: SubCategoryDto[];

  @IsString()
  @IsOptional()
  icon?: string;

  @IsString()
  @IsOptional()
  color?: string;
}

/**
 * DTO de conta com categorias
 */
export class AccountWithCategoriesDto {
  @IsUUID()
  id: string;

  @IsString()
  name: string;

  @IsBoolean()
  isDefault: boolean;

  @IsArray()
  categories: CategoryDto[];
}

/**
 * DTO de resposta de categorias
 */
export class UserCategoriesResponseDto {
  @IsBoolean()
  success: boolean;

  @IsArray()
  accounts: AccountWithCategoriesDto[];
}

/**
 * DTO para autenticação de serviço
 */
export class ServiceAuthDto {
  @IsString()
  clientId: string;

  @IsString()
  clientSecret: string;
}

/**
 * DTO de resposta de autenticação
 */
export class AuthResponseDto {
  @IsString()
  accessToken: string;

  @IsString()
  tokenType: string;

  @IsOptional()
  @IsString()
  expiresIn?: string;
}

import { IsString, IsEmail, IsEnum, IsObject, IsOptional } from 'class-validator';
import { OnboardingStep } from '@prisma/client';

/**
 * DTO para iniciar onboarding
 */
export class StartOnboardingDto {
  @IsString()
  phoneNumber: string;
}

/**
 * DTO para atualizar step do onboarding
 */
export class UpdateOnboardingStepDto {
  @IsString()
  phoneNumber: string;

  @IsEnum(OnboardingStep)
  currentStep: OnboardingStep;

  @IsObject()
  @IsOptional()
  data?: OnboardingData;
}

/**
 * DTO para processar mensagem no onboarding
 */
export class ProcessOnboardingMessageDto {
  @IsString()
  phoneNumber: string;

  @IsString()
  message: string;
}

/**
 * Dados coletados durante onboarding
 */
export interface OnboardingData {
  name?: string;
  email?: string;
  platform?: string; // 'telegram' | 'whatsapp'
  realPhoneNumber?: string; // Telefone real (do contact sharing)
  userId?: string; // ID do usuário existente (quando email já existe)
  verificationCode?: string; // Código de verificação
  resendCode?: boolean; // Flag para reenviar código
}

/**
 * Resposta do processamento de onboarding
 */
export interface OnboardingResponse {
  completed: boolean;
  currentStep: OnboardingStep;
  message: string;
  data?: OnboardingData;
}

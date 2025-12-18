import { Module } from '@nestjs/common';
import { AccountManagementService } from './account-management.service';
import { UsersModule } from '@features/users/users.module';

/**
 * AccountsModule
 *
 * Módulo responsável pelo gerenciamento de contas do usuário.
 * Centraliza operações de:
 * - Listagem de contas
 * - Troca de conta ativa
 * - Validação de conta
 */
@Module({
  imports: [UsersModule],
  providers: [AccountManagementService],
  exports: [AccountManagementService],
})
export class AccountsModule {}

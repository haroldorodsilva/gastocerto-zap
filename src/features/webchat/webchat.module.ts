import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { WebChatController } from './webchat.controller';
import { AuthTestController } from './auth-test.controller';
import { WebChatService } from './webchat.service';
import { TransactionsModule } from '@features/transactions/transactions.module';
import { UsersModule } from '@features/users/users.module';
import { SharedModule } from '@shared/shared.module';
import { CommonModule } from '@common/common.module';

@Module({
  imports: [
    TransactionsModule, // Para processar transações
    UsersModule, // Para buscar dados do usuário
    SharedModule, // Para GastoCertoApiService
    CommonModule, // Para JwtAuthGuard e validação
    MulterModule.register({
      storage: memoryStorage(), // Usar memoryStorage para ter acesso ao buffer
      limits: {
        fileSize: 20 * 1024 * 1024, // 20MB
      },
    }),
  ],
  controllers: [WebChatController, AuthTestController],
  providers: [WebChatService],
  exports: [WebChatService],
})
export class WebChatModule {}

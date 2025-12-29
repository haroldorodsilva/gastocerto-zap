import { Module } from '@nestjs/common';
import { WebChatController } from './webchat.controller';
import { WebChatService } from './webchat.service';
import { TransactionsModule } from '@features/transactions/transactions.module';
import { UsersModule } from '@features/users/users.module';

@Module({
  imports: [
    TransactionsModule, // Para processar transações
    UsersModule, // Para buscar dados do usuário
  ],
  controllers: [WebChatController],
  providers: [WebChatService],
  exports: [WebChatService],
})
export class WebChatModule {}

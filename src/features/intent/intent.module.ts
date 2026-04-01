import { Module } from '@nestjs/common';
import { IntentAnalyzerService } from './intent-analyzer.service';
import { PrismaService } from '@core/database/prisma.service';
import { ConversationModule } from '@features/conversation/conversation.module';

@Module({
  imports: [ConversationModule],
  providers: [IntentAnalyzerService],
  exports: [IntentAnalyzerService],
})
export class IntentModule {}

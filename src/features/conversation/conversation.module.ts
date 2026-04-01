import { Module } from '@nestjs/common';
import { CommonModule } from '@common/common.module';
import { ConversationMemoryService } from './conversation-memory.service';
import { DisambiguationService } from './disambiguation.service';

@Module({
  imports: [CommonModule],
  providers: [ConversationMemoryService, DisambiguationService],
  exports: [ConversationMemoryService, DisambiguationService],
})
export class ConversationModule {}

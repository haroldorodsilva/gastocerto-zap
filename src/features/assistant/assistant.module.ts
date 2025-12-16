import { Module } from '@nestjs/common';
import { IntentAnalyzerService } from './intent/intent-analyzer.service';

@Module({
  providers: [IntentAnalyzerService],
  exports: [IntentAnalyzerService],
})
export class AssistantModule {}

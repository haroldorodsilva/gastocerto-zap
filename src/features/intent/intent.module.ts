import { Module } from '@nestjs/common';
import { IntentAnalyzerService } from './intent-analyzer.service';
import { PrismaService } from '@core/database/prisma.service';

@Module({
  providers: [IntentAnalyzerService],
  exports: [IntentAnalyzerService],
})
export class IntentModule {}

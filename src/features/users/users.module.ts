import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { GastoCertoApiService } from '@shared/gasto-certo-api.service';
import { UserCacheService } from './user-cache.service';
import { PrismaService } from '@core/database/prisma.service';
import { CommonModule } from '@common/common.module';
import { RAGModule } from '../../infrastructure/ai/rag/rag.module';
import { AiModule } from '../../infrastructure/ai/ai.module';

@Module({
  imports: [HttpModule, CommonModule, RAGModule, AiModule],
  providers: [GastoCertoApiService, UserCacheService],
  exports: [GastoCertoApiService, UserCacheService],
})
export class UsersModule {}

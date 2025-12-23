import { Module } from '@nestjs/common';
import { RAGService } from './rag.service';
import { RAGLearningService } from './rag-learning.service';
import { CategoryResolutionService } from '../category-resolution.service';
import { AIUsageLoggerService } from '../ai-usage-logger.service';
import { PrismaService } from '@core/database/prisma.service';

/**
 * RAG Module
 *
 * Fornece serviços de Retrieval-Augmented Generation
 * para matching semântico de categorias
 */
@Module({
  providers: [
    PrismaService,
    RAGService,
    RAGLearningService,
    AIUsageLoggerService,
    CategoryResolutionService,
  ],
  exports: [RAGService, RAGLearningService, CategoryResolutionService],
})
export class RAGModule {}

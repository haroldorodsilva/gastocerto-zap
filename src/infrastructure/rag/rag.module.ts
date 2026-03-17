import { Module } from '@nestjs/common';
import { RAGService } from './services/rag.service';
import { RAGLearningService } from './services/rag-learning.service';
import { CategoryResolutionService } from './services/category-resolution.service';
import { AIUsageLoggerService } from '@infrastructure/ai/ai-usage-logger.service';
import { TextProcessingService } from './services/text-processing.service';
import { UserSynonymService } from './services/user-synonym.service';

/**
 * RAG Module
 *
 * Fornece serviços de Retrieval-Augmented Generation
 * para matching semântico de categorias
 */
@Module({
  providers: [
    TextProcessingService,
    UserSynonymService,
    RAGService,
    RAGLearningService,
    AIUsageLoggerService,
    CategoryResolutionService,
  ],
  exports: [RAGService, RAGLearningService, CategoryResolutionService, TextProcessingService, UserSynonymService],
})
export class RAGModule {}

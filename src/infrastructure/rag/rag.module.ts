import { Module } from '@nestjs/common';
import { RAGService } from './services/rag.service';
import { RagCacheService } from './services/rag-cache.service';
import { RagScoringService } from './services/rag-scoring.service';
import { RagAnalyticsService } from './services/rag-analytics.service';
import { RagSearchService } from './services/rag-search.service';
import { RAGLearningService } from './services/rag-learning.service';
import { CategoryResolutionService } from './services/category-resolution.service';
import { AIUsageLoggerService } from '@infrastructure/ai/ai-usage-logger.service';
import { TextProcessingService } from './services/text-processing.service';
import { UserSynonymService } from './services/user-synonym.service';

/**
 * RAGModule
 *
 * Organização por responsabilidade:
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  RAGService (facade)  ←  mantém API pública compatível      │
 * │       ↓               ↓               ↓                    │
 * │  RagCacheService  RagSearchService  RagAnalyticsService     │
 * │  (Redis/Map)      (BM25+bigrams)    (DB logging)            │
 * │                       ↓                                     │
 * │                 RagScoringService   UserSynonymService       │
 * │                 (algoritmos puro)   (CRUD sinônimos/conta)   │
 * └─────────────────────────────────────────────────────────────┘
 *
 * Serviços orquestradores (usam RAGService):
 * - RAGLearningService: fluxo de aprendizado de termos
 * - CategoryResolutionService: RAG + IA fallback com tracking
 */
@Module({
  providers: [
    // Processamento de texto (sem I/O)
    TextProcessingService,

    // Scoring BM25 + bigrams + sinônimos (sem I/O)
    RagScoringService,

    // Cache de categorias (Redis/Map, accountId-aware)
    RagCacheService,

    // Analytics / DB logging (fire-and-forget)
    RagAnalyticsService,

    // Sinônimos personalizados por conta (n:m)
    UserSynonymService,

    // Motor de busca (orquestra cache + scoring + analytics + sinônimos)
    RagSearchService,

    // Facade pública (compatibilidade com todos os callers existentes)
    RAGService,

    // Fluxo de aprendizado de termos desconhecidos
    RAGLearningService,

    // Analytics de uso de IA (para CategoryResolutionService)
    AIUsageLoggerService,

    // Orquestração RAG + IA fallback
    CategoryResolutionService,
  ],
  exports: [
    RAGService,
    RAGLearningService,
    CategoryResolutionService,
    TextProcessingService,
    UserSynonymService,
    RagCacheService,
    RagSearchService,
    RagAnalyticsService,
  ],
})
export class RAGModule {}

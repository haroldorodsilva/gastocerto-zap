import { Module } from '@nestjs/common';
import { RAGService } from './rag.service';

/**
 * RAG Module
 *
 * Fornece serviços de Retrieval-Augmented Generation
 * para matching semântico de categorias
 */
@Module({
  providers: [RAGService],
  exports: [RAGService],
})
export class RAGModule {}

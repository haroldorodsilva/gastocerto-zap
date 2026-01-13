import { Module } from '@nestjs/common';
import { IntentMatcher } from './services/intent-matcher.service';

/**
 * NLP Module - Natural Language Processing
 * 
 * Responsável por análise de intenção e processamento de linguagem natural
 * 
 * Serviços:
 * - IntentMatcher: Identifica intenções em mensagens de texto
 */
@Module({
  providers: [IntentMatcher],
  exports: [IntentMatcher],
})
export class NLPModule {}

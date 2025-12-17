import { Module } from '@nestjs/common';
import { AIProviderFactory } from './ai-provider.factory';
import { OpenAIProvider } from './providers/openai.provider';
import { GoogleGeminiProvider } from './providers/google-gemini.provider';
import { GroqProvider } from './providers/groq.provider';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { RateLimiterService } from '../../common/services/rate-limiter.service';
import { AICacheService } from '../../common/services/ai-cache.service';
import { RedisService } from '../../common/services/redis.service';
import { AIUsageLoggerService } from './ai-usage-logger.service';
import { AIUsageTrackerService } from './ai-usage-tracker.service';
import { AIConfigService } from './ai-config.service';
import { AINormalizationService } from './ai-normalization.service';
import { PrismaService } from '@core/database/prisma.service';

@Module({
  providers: [
    PrismaService,
    RedisService,
    AIProviderFactory,
    OpenAIProvider,
    GoogleGeminiProvider,
    GroqProvider,
    DeepSeekProvider,
    RateLimiterService,
    AICacheService,
    AIUsageLoggerService,
    AIUsageTrackerService,
    AIConfigService,
    AINormalizationService,
  ],
  exports: [
    AIProviderFactory,
    RedisService,
    RateLimiterService,
    AICacheService,
    AIUsageLoggerService,
    AIUsageTrackerService,
    AIConfigService,
  ],
})
export class AiModule {}

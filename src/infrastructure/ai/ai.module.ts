import { Module } from '@nestjs/common';
import { AIProviderFactory } from './ai-provider.factory';
import { OpenAIProvider } from './providers/openai.provider';
import { GoogleGeminiProvider } from './providers/google-gemini.provider';
import { GroqProvider } from './providers/groq.provider';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { RateLimiterService } from '../../common/services/rate-limiter.service';
import { AICacheService } from '../../common/services/ai-cache.service';
import { AIUsageLoggerService } from './ai-usage-logger.service';
import { AIConfigService } from './ai-config.service';
import { AINormalizationService } from './ai-normalization.service';
import { AICredentialSelectorService } from './credentials/ai-credential-selector.service';
import { AICredentialResetCron } from './credentials/ai-credential-reset.cron';
@Module({
  providers: [
    AIProviderFactory,
    OpenAIProvider,
    GoogleGeminiProvider,
    GroqProvider,
    DeepSeekProvider,
    RateLimiterService,
    AICacheService,
    AIUsageLoggerService,
    AIConfigService,
    AINormalizationService,
    AICredentialSelectorService,
    AICredentialResetCron,
  ],
  exports: [
    AIProviderFactory,
    RateLimiterService,
    AICacheService,
    AIUsageLoggerService,
    AIConfigService,
    AICredentialSelectorService,
  ],
})
export class AiModule {}

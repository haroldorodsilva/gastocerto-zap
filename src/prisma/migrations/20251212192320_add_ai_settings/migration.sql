-- CreateTable
CREATE TABLE "ai_settings" (
    "id" TEXT NOT NULL,
    "primaryProvider" TEXT NOT NULL DEFAULT 'groq',
    "fallbackEnabled" BOOLEAN NOT NULL DEFAULT true,
    "fallbackTextChain" TEXT[] DEFAULT ARRAY['groq', 'deepseek', 'google_gemini', 'openai']::TEXT[],
    "fallbackImageChain" TEXT[] DEFAULT ARRAY['google_gemini', 'openai']::TEXT[],
    "fallbackAudioChain" TEXT[] DEFAULT ARRAY['openai', 'groq']::TEXT[],
    "fallbackCategoryChain" TEXT[] DEFAULT ARRAY['groq', 'deepseek', 'google_gemini', 'openai']::TEXT[],
    "cacheEnabled" BOOLEAN NOT NULL DEFAULT false,
    "cacheTTL" INTEGER NOT NULL DEFAULT 3600,
    "rateLimitEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("id")
);

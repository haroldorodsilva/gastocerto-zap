-- AlterTable
ALTER TABLE "ai_settings" ADD COLUMN     "audioProvider" TEXT NOT NULL DEFAULT 'groq',
ADD COLUMN     "categoryProvider" TEXT NOT NULL DEFAULT 'groq',
ADD COLUMN     "imageProvider" TEXT NOT NULL DEFAULT 'google_gemini',
ADD COLUMN     "textProvider" TEXT NOT NULL DEFAULT 'openai';

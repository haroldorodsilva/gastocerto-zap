-- AlterTable: Add userCacheId to onboarding_sessions
ALTER TABLE "onboarding_sessions" ADD COLUMN "userCacheId" TEXT;

-- CreateIndex: Add index on userCacheId
CREATE INDEX "onboarding_sessions_userCacheId_idx" ON "onboarding_sessions"("userCacheId");

-- AddForeignKey: Link OnboardingSession to UserCache
ALTER TABLE "onboarding_sessions" ADD CONSTRAINT "onboarding_sessions_userCacheId_fkey" FOREIGN KEY ("userCacheId") REFERENCES "user_cache"("id") ON DELETE SET NULL ON UPDATE CASCADE;

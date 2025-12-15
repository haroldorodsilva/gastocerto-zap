-- CreateTable
CREATE TABLE "unrecognized_messages" (
    "id" TEXT NOT NULL,
    "userCacheId" TEXT,
    "phoneNumber" TEXT NOT NULL,
    "messageText" TEXT NOT NULL,
    "detectedIntent" TEXT,
    "confidence" DOUBLE PRECISION,
    "wasProcessed" BOOLEAN NOT NULL DEFAULT false,
    "addedToContext" BOOLEAN NOT NULL DEFAULT false,
    "userFeedback" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unrecognized_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "unrecognized_messages_userCacheId_idx" ON "unrecognized_messages"("userCacheId");

-- CreateIndex
CREATE INDEX "unrecognized_messages_phoneNumber_idx" ON "unrecognized_messages"("phoneNumber");

-- CreateIndex
CREATE INDEX "unrecognized_messages_wasProcessed_idx" ON "unrecognized_messages"("wasProcessed");

-- CreateIndex
CREATE INDEX "unrecognized_messages_addedToContext_idx" ON "unrecognized_messages"("addedToContext");

-- CreateIndex
CREATE INDEX "unrecognized_messages_createdAt_idx" ON "unrecognized_messages"("createdAt");

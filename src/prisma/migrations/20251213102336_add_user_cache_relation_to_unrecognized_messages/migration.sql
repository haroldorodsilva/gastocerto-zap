-- AddForeignKey
ALTER TABLE "unrecognized_messages" ADD CONSTRAINT "unrecognized_messages_userCacheId_fkey" FOREIGN KEY ("userCacheId") REFERENCES "user_cache"("id") ON DELETE SET NULL ON UPDATE CASCADE;

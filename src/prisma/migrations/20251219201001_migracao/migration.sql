/*
  Warnings:

  - Made the column `categoryId` on table `user_synonyms` required. This step will fail if there are existing NULL values in that column.
  - Made the column `categoryName` on table `user_synonyms` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "user_synonyms" ALTER COLUMN "categoryId" SET NOT NULL,
ALTER COLUMN "categoryName" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_ragSearchLogId_fkey" FOREIGN KEY ("ragSearchLogId") REFERENCES "rag_search_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

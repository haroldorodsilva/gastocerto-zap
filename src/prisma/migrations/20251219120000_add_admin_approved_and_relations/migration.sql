-- Add ADMIN_APPROVED to SynonymSource enum
ALTER TYPE "SynonymSource" ADD VALUE IF NOT EXISTS 'ADMIN_APPROVED';

-- Add relation from AIUsageLog to RAGSearchLog (if not exists)
-- This is a forward relation, so no migration needed in PostgreSQL
-- The relation is virtual in Prisma Client

-- Add aiUsageLogs relation to RAGSearchLog (reverse relation)
-- This is also virtual in Prisma Client, no database changes needed

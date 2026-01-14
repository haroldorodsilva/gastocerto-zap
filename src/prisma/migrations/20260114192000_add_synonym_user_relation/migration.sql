-- AddUnique constraint for user synonyms (userId + keyword)
-- This ensures a user cannot have duplicate keywords
-- For global synonyms (userId = NULL), this allows the same keyword to exist once

-- Create unique index if it doesn't exist
CREATE UNIQUE INDEX IF NOT EXISTS "user_synonyms_userId_keyword_key" 
ON "user_synonyms"("userId", "keyword");

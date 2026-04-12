ALTER TABLE "conversation_messages"
ADD COLUMN IF NOT EXISTS "sync_detail" text;

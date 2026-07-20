-- CreateTable
CREATE TABLE IF NOT EXISTS "JordanSavedChat" (
    "id"        TEXT NOT NULL,
    "ownerId"   TEXT NOT NULL,
    "mode"      TEXT NOT NULL DEFAULT 'chat',
    "title"     TEXT NOT NULL DEFAULT '',
    "messages"  JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JordanSavedChat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "JordanSavedChat_ownerId_mode_idx" ON "JordanSavedChat"("ownerId", "mode");

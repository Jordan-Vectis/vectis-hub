-- Photo Prep → Image chat: saved conversations, private to the person who made them.
CREATE TABLE IF NOT EXISTS "ImageChat" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "turns" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ImageChat_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ImageChat_userId_updatedAt_idx" ON "ImageChat"("userId", "updatedAt");

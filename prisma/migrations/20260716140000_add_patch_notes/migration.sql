-- Patch notes: a dated "what's changed" note per release, plus one row per user
-- per note they've clicked through (so a shared iPad shows it to each person).
--
-- IF NOT EXISTS throughout because this may be applied by hand — `prisma migrate
-- deploy` on startup can silently time out acquiring an advisory lock against
-- Neon's pooled endpoint and leave the migration unapplied.

-- CreateTable
CREATE TABLE IF NOT EXISTS "PatchNote" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByName" TEXT,

    CONSTRAINT "PatchNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PatchNoteSeen" (
    "id" TEXT NOT NULL,
    "patchNoteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatchNoteSeen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PatchNote_published_createdAt_idx" ON "PatchNote"("published", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PatchNoteSeen_userId_idx" ON "PatchNoteSeen"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PatchNoteSeen_patchNoteId_userId_key" ON "PatchNoteSeen"("patchNoteId", "userId");

-- AddForeignKey
ALTER TABLE "PatchNoteSeen" DROP CONSTRAINT IF EXISTS "PatchNoteSeen_patchNoteId_fkey";
ALTER TABLE "PatchNoteSeen" ADD CONSTRAINT "PatchNoteSeen_patchNoteId_fkey" FOREIGN KEY ("patchNoteId") REFERENCES "PatchNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

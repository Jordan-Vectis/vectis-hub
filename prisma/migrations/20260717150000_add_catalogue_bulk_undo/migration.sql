-- CreateTable
CREATE TABLE IF NOT EXISTS "CatalogueBulkUndo" (
    "id"        TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "actorId"   TEXT NOT NULL,
    "actorName" TEXT NOT NULL DEFAULT '',
    "label"     TEXT NOT NULL DEFAULT '',
    "entries"   JSONB NOT NULL,
    "undone"    BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogueBulkUndo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CatalogueBulkUndo_auctionId_actorId_undone_createdAt_idx" ON "CatalogueBulkUndo"("auctionId", "actorId", "undone", "createdAt");

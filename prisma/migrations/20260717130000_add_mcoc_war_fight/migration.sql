-- CreateTable
CREATE TABLE IF NOT EXISTS "McocWarFight" (
    "id"            TEXT NOT NULL,
    "ownerId"       TEXT NOT NULL,
    "order"         INTEGER NOT NULL DEFAULT 0,
    "defender"      TEXT NOT NULL DEFAULT '',
    "nodesImageKey" TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McocWarFight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "McocWarFight_ownerId_idx" ON "McocWarFight"("ownerId");

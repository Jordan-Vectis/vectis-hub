-- CreateTable
CREATE TABLE IF NOT EXISTS "CatalogueLotDraft" (
    "id"              TEXT NOT NULL,
    "auctionId"       TEXT NOT NULL,
    "userId"          TEXT NOT NULL,
    "step"            INTEGER NOT NULL DEFAULT 2,
    "vendor"          TEXT NOT NULL DEFAULT '',
    "tote"            TEXT NOT NULL DEFAULT '',
    "receipt"         TEXT NOT NULL DEFAULT '',
    "barcode"         TEXT NOT NULL DEFAULT '',
    "keyPoints"       TEXT NOT NULL DEFAULT '',
    "aiExcluded"      BOOLEAN NOT NULL DEFAULT false,
    "manualDesc"      TEXT NOT NULL DEFAULT '',
    "category"        TEXT NOT NULL DEFAULT '',
    "subCategory"     TEXT NOT NULL DEFAULT '',
    "brand"           TEXT NOT NULL DEFAULT '',
    "estimateLow"     TEXT NOT NULL DEFAULT '',
    "estimateHigh"    TEXT NOT NULL DEFAULT '',
    "cond1"           TEXT NOT NULL DEFAULT '',
    "cond2"           TEXT NOT NULL DEFAULT '',
    "boxOn"           BOOLEAN NOT NULL DEFAULT false,
    "boxPrefixMode"   TEXT NOT NULL DEFAULT 'Box is',
    "boxCustomPrefix" TEXT NOT NULL DEFAULT '',
    "boxCond1"        TEXT NOT NULL DEFAULT '',
    "boxCond2"        TEXT NOT NULL DEFAULT '',
    "parcel"          TEXT NOT NULL DEFAULT '',
    "photoCount"      INTEGER NOT NULL DEFAULT 0,
    "startedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogueLotDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CatalogueLotDraft_auctionId_userId_key" ON "CatalogueLotDraft"("auctionId", "userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CatalogueLotDraft_userId_idx" ON "CatalogueLotDraft"("userId");

DO $$ BEGIN
    ALTER TABLE "CatalogueLotDraft" ADD CONSTRAINT "CatalogueLotDraft_auctionId_fkey"
        FOREIGN KEY ("auctionId") REFERENCES "CatalogueAuction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "CatalogueLotDraft" ADD CONSTRAINT "CatalogueLotDraft_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

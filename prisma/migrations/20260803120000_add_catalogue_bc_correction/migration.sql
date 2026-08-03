-- CreateTable
CREATE TABLE IF NOT EXISTS "CatalogueBcCorrection" (
    "id"              TEXT NOT NULL,
    "auctionId"       TEXT NOT NULL,
    "lotId"           TEXT NOT NULL,
    "barcode"         TEXT,
    "receiptUniqueId" TEXT,
    "title"           TEXT,
    "tote"            TEXT,
    "oldVendor"       TEXT,
    "oldReceipt"      TEXT,
    "newVendor"       TEXT,
    "newReceipt"      TEXT,
    "done"            BOOLEAN NOT NULL DEFAULT false,
    "doneBy"          TEXT,
    "doneAt"          TIMESTAMP(3),
    "correctedBy"     TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogueBcCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CatalogueBcCorrection_auctionId_lotId_key" ON "CatalogueBcCorrection"("auctionId", "lotId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CatalogueBcCorrection_auctionId_done_idx" ON "CatalogueBcCorrection"("auctionId", "done");

DO $$ BEGIN
    ALTER TABLE "CatalogueBcCorrection" ADD CONSTRAINT "CatalogueBcCorrection_auctionId_fkey"
        FOREIGN KEY ("auctionId") REFERENCES "CatalogueAuction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

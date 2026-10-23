-- BC's receipts and totes copied INTO Goods In's own tables (2026-10-23), the way customers were:
-- one database, BC in charge of its rows until switch day (WAREHOUSE_OWNER=hub). `source` says who
-- made a row ("bc" = copied from Business Central; null/"hub" = booked in the Hub), `bcSyncedAt`
-- when the copy last touched it, `bcData` everything the BC copy had for it.
ALTER TABLE "GoodsInReceipt" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "GoodsInReceipt" ADD COLUMN IF NOT EXISTS "bcSyncedAt" TIMESTAMP(3);
ALTER TABLE "GoodsInReceipt" ADD COLUMN IF NOT EXISTS "bcData" JSONB;
ALTER TABLE "GoodsInContainer" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "GoodsInContainer" ADD COLUMN IF NOT EXISTS "bcSyncedAt" TIMESTAMP(3);
ALTER TABLE "GoodsInContainer" ADD COLUMN IF NOT EXISTS "bcData" JSONB;
CREATE INDEX IF NOT EXISTS "GoodsInReceipt_source_idx" ON "GoodsInReceipt"("source");
CREATE INDEX IF NOT EXISTS "GoodsInContainer_source_idx" ON "GoodsInContainer"("source");

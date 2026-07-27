-- SystemCreatedAt from Receipt_Totes_Excel — when the tote was created in BC.
-- Drives the Manager Portal "Stock from" figure. Populated by the totes-active
-- sync; existing rows fill in on the next run.
ALTER TABLE "WarehouseTote" ADD COLUMN IF NOT EXISTS "bcCreatedAt" TIMESTAMP(3);

-- Databases → Sales: each sale's BC code and its cover picture (the website's auction-calendar
-- "hero") — the address on the website's S3 and, once copied, our own file in R2.
ALTER TABLE "ArchiveSale" ADD COLUMN IF NOT EXISTS "code" TEXT;
ALTER TABLE "ArchiveSale" ADD COLUMN IF NOT EXISTS "heroUrl" TEXT;
ALTER TABLE "ArchiveSale" ADD COLUMN IF NOT EXISTS "heroKey" TEXT;
ALTER TABLE "ArchiveSale" ADD COLUMN IF NOT EXISTS "heroAt" TIMESTAMP(3);

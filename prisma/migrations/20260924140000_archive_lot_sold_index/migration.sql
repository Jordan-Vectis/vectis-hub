-- Counting the sold lots for the test website's stats band read all 956k ArchiveLot rows; this
-- partial index holds only the sold ones, so the count comes from the index. (Prisma's schema
-- cannot express a partial index — this migration is its only definition.)
CREATE INDEX IF NOT EXISTS "ArchiveLot_sold_idx" ON "ArchiveLot" ("hammerPrice") WHERE "hammerPrice" > 0 OR "siteHammerPrice" > 0;

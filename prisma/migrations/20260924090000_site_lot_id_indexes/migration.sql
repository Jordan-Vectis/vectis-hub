-- The department pages look a highlighted lot up by the website's lot id to link to our own results page.
CREATE INDEX IF NOT EXISTS "ArchiveLot_siteLotId_idx" ON "ArchiveLot"("siteLotId");
CREATE INDEX IF NOT EXISTS "BcLotWeb_siteLotId_idx" ON "BcLotWeb"("siteLotId");

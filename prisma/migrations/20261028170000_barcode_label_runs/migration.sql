-- Admin & Operations → Barcode Labels: one PDF of Lot ID labels made — the sale, the running numbers,
-- who and when — so the next run for a sale carries on from the last number.
CREATE TABLE IF NOT EXISTS "BarcodeLabelRun" (
    "id"         TEXT NOT NULL PRIMARY KEY,
    "saleCode"   TEXT NOT NULL,
    "saleDate"   TEXT,
    "fromNo"     INTEGER NOT NULL,
    "toNo"       INTEGER NOT NULL,
    "count"      INTEGER NOT NULL,
    "startAt"    INTEGER NOT NULL DEFAULT 1,
    "madeById"   TEXT,
    "madeByName" TEXT NOT NULL,
    "madeAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "BarcodeLabelRun_saleCode_madeAt_idx" ON "BarcodeLabelRun"("saleCode", "madeAt");
CREATE INDEX IF NOT EXISTS "BarcodeLabelRun_madeAt_idx" ON "BarcodeLabelRun"("madeAt");

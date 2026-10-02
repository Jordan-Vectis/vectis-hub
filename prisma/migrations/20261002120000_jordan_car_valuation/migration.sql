-- JORDAN.SYS garage: what a car was worth on a given date (2026-10-02).
CREATE TABLE IF NOT EXISTS "JordanCarValuation" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "carId"     TEXT NOT NULL,
    "asOf"      TIMESTAMP(3) NOT NULL,
    "low"       INTEGER,
    "mid"       INTEGER NOT NULL,
    "high"      INTEGER,
    "tradeIn"   INTEGER,
    "mileage"   INTEGER,
    "source"    TEXT NOT NULL DEFAULT 'AI',
    "note"      TEXT NOT NULL DEFAULT '',
    "model"     TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JordanCarValuation_carId_fkey" FOREIGN KEY ("carId")
      REFERENCES "JordanCar"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "JordanCarValuation_carId_idx" ON "JordanCarValuation"("carId");
CREATE INDEX IF NOT EXISTS "JordanCarValuation_asOf_idx" ON "JordanCarValuation"("asOf");

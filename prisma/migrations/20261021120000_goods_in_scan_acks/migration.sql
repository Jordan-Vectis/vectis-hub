-- Goods In handheld scanner (2026-10-21). Same statements as the MIGRATIONS array in lib/migrations.ts.

CREATE TABLE IF NOT EXISTS "GoodsInScanAck" (
    "id"             TEXT NOT NULL,
    "userId"         TEXT NOT NULL,
    "userName"       TEXT,
    "deviceId"       TEXT,
    "code"           TEXT,
    "problem"        TEXT NOT NULL,
    "reason"         TEXT,
    "scanId"         TEXT,
    "scannedAt"      TIMESTAMP(3),
    "shownAt"        TIMESTAMP(3) NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoodsInScanAck_pkey" PRIMARY KEY ("id")
  );

CREATE INDEX IF NOT EXISTS "GoodsInScanAck_userId_acknowledgedAt_idx" ON "GoodsInScanAck"("userId", "acknowledgedAt");

CREATE INDEX IF NOT EXISTS "GoodsInScanAck_acknowledgedAt_idx" ON "GoodsInScanAck"("acknowledgedAt");

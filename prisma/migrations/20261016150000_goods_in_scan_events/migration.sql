-- Goods In scanner app (2026-10-16). Same statements as the MIGRATIONS array in lib/migrations.ts.

CREATE TABLE IF NOT EXISTS "GoodsInScanEvent" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "userName"   TEXT,
    "deviceId"   TEXT,
    "action"     TEXT NOT NULL,
    "item"       TEXT,
    "location"   TEXT,
    "scannedAt"  TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome"    TEXT NOT NULL,
    "message"    TEXT,
    CONSTRAINT "GoodsInScanEvent_pkey" PRIMARY KEY ("id")
  );

CREATE INDEX IF NOT EXISTS "GoodsInScanEvent_userId_receivedAt_idx" ON "GoodsInScanEvent"("userId", "receivedAt");

CREATE INDEX IF NOT EXISTS "GoodsInScanEvent_deviceId_receivedAt_idx" ON "GoodsInScanEvent"("deviceId", "receivedAt");

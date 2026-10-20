-- Goods In → Reports (2026-10-20). Same statements as the MIGRATIONS array in lib/migrations.ts.

CREATE INDEX IF NOT EXISTS "GoodsInMovement_movedAt_idx" ON "GoodsInMovement"("movedAt");

CREATE INDEX IF NOT EXISTS "GoodsInScanEvent_scannedAt_idx" ON "GoodsInScanEvent"("scannedAt");

-- Goods In scanner sign-in cards (2026-10-16). Same statements as the MIGRATIONS array in lib/migrations.ts.

CREATE TABLE IF NOT EXISTS "GoodsInScannerPass" (
    "id"            TEXT NOT NULL,
    "userId"        TEXT NOT NULL,
    "userName"      TEXT,
    "tokenHash"     TEXT NOT NULL,
    "label"         TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById"   TEXT,
    "createdByName" TEXT,
    "lastUsedAt"    TIMESTAMP(3),
    "revokedAt"     TIMESTAMP(3),
    "revokedByName" TEXT,
    CONSTRAINT "GoodsInScannerPass_pkey" PRIMARY KEY ("id")
  );

CREATE UNIQUE INDEX IF NOT EXISTS "GoodsInScannerPass_tokenHash_key" ON "GoodsInScannerPass"("tokenHash");

CREATE INDEX IF NOT EXISTS "GoodsInScannerPass_userId_idx" ON "GoodsInScannerPass"("userId");

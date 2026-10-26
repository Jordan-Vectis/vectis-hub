-- Accounts → Refunds (2026-10-26). Same statements as the MIGRATIONS array in lib/migrations.ts.

CREATE TABLE IF NOT EXISTS "Refund" (
    "id"              TEXT NOT NULL,
    "ref"             INTEGER NOT NULL,
    "source"          TEXT NOT NULL DEFAULT 'form',
    "importKey"       TEXT,
    "receivedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name"            TEXT NOT NULL,
    "email"           TEXT,
    "customerNo"      TEXT,
    "customerId"      TEXT,
    "party"           TEXT NOT NULL DEFAULT 'buyer',
    "saleCode"        TEXT,
    "auctionDate"     TIMESTAMP(3),
    "lotsText"        TEXT,
    "reason"          TEXT NOT NULL DEFAULT 'other',
    "details"         TEXT,
    "photoKeys"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status"          TEXT NOT NULL DEFAULT 'new',
    "solution"        TEXT,
    "percentText"     TEXT,
    "hammerPence"     INTEGER,
    "commissionPence" INTEGER,
    "postagePence"    INTEGER,
    "totalPence"      INTEGER,
    "refCode"         TEXT,
    "dealtWithName"   TEXT,
    "dealtWithId"     TEXT,
    "processedAt"     TIMESTAMP(3),
    "accountsDoneAt"  TIMESTAMP(3),
    "accountsDoneBy"  TEXT,
    "notes"           TEXT,
    "importedRaw"     JSONB,
    "ipHash"          TEXT,
    "suspect"         BOOLEAN NOT NULL DEFAULT false,
    "closedAt"        TIMESTAMP(3),
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
  );

CREATE UNIQUE INDEX IF NOT EXISTS "Refund_ref_key" ON "Refund"("ref");

CREATE UNIQUE INDEX IF NOT EXISTS "Refund_importKey_key" ON "Refund"("importKey");

CREATE INDEX IF NOT EXISTS "Refund_status_idx" ON "Refund"("status");

CREATE INDEX IF NOT EXISTS "Refund_receivedAt_idx" ON "Refund"("receivedAt");

CREATE INDEX IF NOT EXISTS "Refund_customerNo_idx" ON "Refund"("customerNo");

CREATE INDEX IF NOT EXISTS "Refund_ipHash_receivedAt_idx" ON "Refund"("ipHash", "receivedAt");

CREATE TABLE IF NOT EXISTS "RefundLot" (
    "id"              TEXT NOT NULL,
    "refundId"        TEXT NOT NULL,
    "position"        INTEGER NOT NULL DEFAULT 0,
    "saleCode"        TEXT,
    "lotNo"           TEXT NOT NULL,
    "uniqueId"        TEXT,
    "description"     TEXT,
    "hammerPence"     INTEGER,
    "commissionPence" INTEGER,
    "basis"           TEXT NOT NULL DEFAULT 'percent',
    "percent"         DOUBLE PRECISION,
    "setAmountPence"  INTEGER,
    "fromBc"          BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "RefundLot_pkey" PRIMARY KEY ("id")
  );

CREATE INDEX IF NOT EXISTS "RefundLot_refundId_idx" ON "RefundLot"("refundId");

DO $$ BEGIN
    ALTER TABLE "RefundLot" ADD CONSTRAINT "RefundLot_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "RefundEvent" (
    "id"       TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "kind"     TEXT NOT NULL,
    "text"     TEXT,
    "byId"     TEXT,
    "byName"   TEXT,
    "at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RefundEvent_pkey" PRIMARY KEY ("id")
  );

CREATE INDEX IF NOT EXISTS "RefundEvent_refundId_at_idx" ON "RefundEvent"("refundId", "at");

DO $$ BEGIN
    ALTER TABLE "RefundEvent" ADD CONSTRAINT "RefundEvent_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

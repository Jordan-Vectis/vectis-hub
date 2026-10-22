-- Accounts → Paid, not collected (2026-10-22). Same statements as the MIGRATIONS array in lib/migrations.ts.

CREATE TABLE IF NOT EXISTS "UncollectedPaid" (
    "id"            TEXT NOT NULL,
    "source"        TEXT NOT NULL DEFAULT 'manual',
    "bcKey"         TEXT,
    "buyerNo"       TEXT,
    "customerId"    TEXT,
    "buyerName"     TEXT NOT NULL,
    "email"         TEXT,
    "phone"         TEXT,
    "saleCode"      TEXT,
    "invoiceNo"     TEXT,
    "lots"          INTEGER,
    "amountPaid"    DOUBLE PRECISION,
    "paidAt"        TIMESTAMP(3),
    "status"        TEXT NOT NULL DEFAULT 'waiting',
    "nextChaseAt"   TIMESTAMP(3),
    "storageFrom"   TIMESTAMP(3),
    "notes"         TEXT,
    "createdById"   TEXT,
    "createdByName" TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt"      TIMESTAMP(3),
    CONSTRAINT "UncollectedPaid_pkey" PRIMARY KEY ("id")
  );

CREATE UNIQUE INDEX IF NOT EXISTS "UncollectedPaid_bcKey_key" ON "UncollectedPaid"("bcKey");

CREATE INDEX IF NOT EXISTS "UncollectedPaid_status_idx" ON "UncollectedPaid"("status");

CREATE INDEX IF NOT EXISTS "UncollectedPaid_paidAt_idx" ON "UncollectedPaid"("paidAt");

CREATE INDEX IF NOT EXISTS "UncollectedPaid_buyerNo_idx" ON "UncollectedPaid"("buyerNo");

CREATE INDEX IF NOT EXISTS "UncollectedPaid_nextChaseAt_idx" ON "UncollectedPaid"("nextChaseAt");

CREATE TABLE IF NOT EXISTS "UncollectedPaidEvent" (
    "id"     TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "kind"   TEXT NOT NULL,
    "text"   TEXT,
    "byId"   TEXT,
    "byName" TEXT,
    "at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UncollectedPaidEvent_pkey" PRIMARY KEY ("id")
  );

CREATE INDEX IF NOT EXISTS "UncollectedPaidEvent_caseId_at_idx" ON "UncollectedPaidEvent"("caseId", "at");

DO $$ BEGIN
    ALTER TABLE "UncollectedPaidEvent" ADD CONSTRAINT "UncollectedPaidEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "UncollectedPaid"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

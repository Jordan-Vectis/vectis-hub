-- Accounts → Paid, not collected: each case's collection dockets and shipment requests from BC (2026-10-23).
-- Same statements as the MIGRATIONS array in lib/migrations.ts.

CREATE TABLE IF NOT EXISTS "UncollectedShipping" (
    "caseId"        TEXT NOT NULL,
    "collectionNos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "shipmentNos"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "packedBy"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "shipments"     JSONB NOT NULL DEFAULT '[]'::jsonb,
    "checkedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UncollectedShipping_pkey" PRIMARY KEY ("caseId")
  );

CREATE INDEX IF NOT EXISTS "UncollectedShipping_checkedAt_idx" ON "UncollectedShipping"("checkedAt");

DO $$ BEGIN
    ALTER TABLE "UncollectedShipping" ADD CONSTRAINT "UncollectedShipping_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "UncollectedPaid"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

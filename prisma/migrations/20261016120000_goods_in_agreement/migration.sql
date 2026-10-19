-- Goods In customer agreement (2026-10-16). Same statements as the MIGRATIONS array in lib/migrations.ts.

CREATE TABLE IF NOT EXISTS "GoodsInAgreement" (
    "contactId"          TEXT NOT NULL,
    "reservePercent"     INTEGER,
    "termsSignedAt"      TIMESTAMP(3),
    "termsRecordedBy"    TEXT,
    "specialArrangement" TEXT,
    "updatedByName"      TEXT,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoodsInAgreement_pkey" PRIMARY KEY ("contactId")
  );

DO $$ BEGIN
    ALTER TABLE "GoodsInAgreement" ADD CONSTRAINT "GoodsInAgreement_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

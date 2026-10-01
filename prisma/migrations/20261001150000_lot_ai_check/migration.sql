-- What the AI assumed about a lot, and what Double Check saw when it looked again at each
-- named object (2026-10-01). One row per lot; advisory only.
CREATE TABLE IF NOT EXISTS "CatalogueLotAiCheck" (
    "id"        TEXT NOT NULL,
    "lotId"     TEXT NOT NULL,
    "assumed"   TEXT[] DEFAULT ARRAY[]::TEXT[],
    "objects"   JSONB,
    "model"     TEXT,
    "source"    TEXT,
    "checkedBy" TEXT,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CatalogueLotAiCheck_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CatalogueLotAiCheck_lotId_key" ON "CatalogueLotAiCheck"("lotId");
DO $$ BEGIN
    ALTER TABLE "CatalogueLotAiCheck" ADD CONSTRAINT "CatalogueLotAiCheck_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "CatalogueLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

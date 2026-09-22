-- 🚦 Status Centre: a check can be switched off (2026-09-22). NULL = on. Nullable, no default,
-- on purpose — see the note beside these columns in lib/migrations.ts.
ALTER TABLE "StatusService" ADD COLUMN IF NOT EXISTS "disabledAt" TIMESTAMP(3);
ALTER TABLE "StatusService" ADD COLUMN IF NOT EXISTS "disabledBy" TEXT;

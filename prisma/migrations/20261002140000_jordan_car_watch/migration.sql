-- JORDAN.SYS garage: cars being watched (considered), not owned — 2026-10-02.
ALTER TABLE "JordanCar" ADD COLUMN IF NOT EXISTS "isWatch" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "JordanCar" ADD COLUMN IF NOT EXISTS "generation" TEXT NOT NULL DEFAULT '';

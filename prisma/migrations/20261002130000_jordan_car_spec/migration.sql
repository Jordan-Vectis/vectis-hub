-- JORDAN.SYS garage: the spec the valuer reads (variant, engine, trim, mods) — 2026-10-02.
ALTER TABLE "JordanCar" ADD COLUMN IF NOT EXISTS "spec" TEXT NOT NULL DEFAULT '';
ALTER TABLE "JordanCar" ADD COLUMN IF NOT EXISTS "advert" TEXT NOT NULL DEFAULT '';

-- Accounts → Paid, not collected: storage charge settings (2026-10-23). Same statements as the MIGRATIONS array in lib/migrations.ts.

CREATE TABLE IF NOT EXISTS "UncollectedSettings" (
    "id"            TEXT NOT NULL,
    "graceDays"     INTEGER,
    "ratePence"     INTEGER,
    "period"        TEXT,
    "vatPercent"    DOUBLE PRECISION,
    "updatedByName" TEXT,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UncollectedSettings_pkey" PRIMARY KEY ("id")
  );

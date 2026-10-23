-- Accounts → Paid, not collected: each run of the BC check (2026-10-22). Same statements as the MIGRATIONS array in lib/migrations.ts.

CREATE TABLE IF NOT EXISTS "UncollectedSyncRun" (
    "id"         TEXT NOT NULL,
    "startedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "trigger"    TEXT NOT NULL,
    "byName"     TEXT,
    "ok"         BOOLEAN,
    "lotsSeen"   INTEGER,
    "buyers"     INTEGER,
    "found"      INTEGER,
    "added"      INTEGER,
    "updated"    INTEGER,
    "closed"     INTEGER,
    "note"       TEXT,
    "error"      TEXT,
    CONSTRAINT "UncollectedSyncRun_pkey" PRIMARY KEY ("id")
  );

CREATE INDEX IF NOT EXISTS "UncollectedSyncRun_startedAt_idx" ON "UncollectedSyncRun"("startedAt");

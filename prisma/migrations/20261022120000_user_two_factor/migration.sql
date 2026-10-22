-- Two-factor login (2026-10-22). Same statement as the MIGRATIONS array in lib/migrations.ts.
-- Its own table, never columns on "User": login reads User, and a shipped-but-unmigrated column there locks everyone out.

CREATE TABLE IF NOT EXISTS "UserTwoFactor" (
    "userId"        TEXT NOT NULL,
    "required"      BOOLEAN NOT NULL DEFAULT false,
    "secret"        TEXT,
    "enabledAt"     TIMESTAMP(3),
    "backupCodes"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "lastStep"      INTEGER,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedByName" TEXT,
    CONSTRAINT "UserTwoFactor_pkey" PRIMARY KEY ("userId")
  );

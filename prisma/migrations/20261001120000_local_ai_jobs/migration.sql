-- Office PC model trial (2026-10-01): a machine in the office runs an open-weight model and
-- PULLS description jobs from the Hub. Preview only — nothing here is ever written to a lot.
CREATE TABLE IF NOT EXISTS "LocalAiWorker" (
    "id"         TEXT NOT NULL,
    "name"       TEXT NOT NULL,
    "tokenHash"  TEXT NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy"  TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "lastModel"  TEXT,
    "lastInfo"   TEXT,
    "disabledAt" TIMESTAMP(3),
    CONSTRAINT "LocalAiWorker_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LocalAiWorker_tokenHash_key" ON "LocalAiWorker"("tokenHash");

CREATE TABLE IF NOT EXISTS "LocalAiJob" (
    "id"                TEXT NOT NULL,
    "batchId"           TEXT NOT NULL,
    "status"            TEXT NOT NULL DEFAULT 'QUEUED',
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy"         TEXT NOT NULL,
    "auctionCode"       TEXT NOT NULL,
    "lotId"             TEXT NOT NULL,
    "lotLabel"          TEXT NOT NULL,
    "presetKey"         TEXT NOT NULL,
    "systemInstruction" TEXT NOT NULL,
    "userPrompt"        TEXT NOT NULL,
    "imageUrls"         TEXT[] DEFAULT ARRAY[]::TEXT[],
    "workerId"          TEXT,
    "leasedAt"          TIMESTAMP(3),
    "leaseExpiresAt"    TIMESTAMP(3),
    "finishedAt"        TIMESTAMP(3),
    "model"             TEXT,
    "description"       TEXT,
    "estimate"          TEXT,
    "flag"              TEXT,
    "rawResponse"       TEXT,
    "error"             TEXT,
    "promptTokens"      INTEGER,
    "outputTokens"      INTEGER,
    "ms"                INTEGER,
    "imageCount"        INTEGER,
    CONSTRAINT "LocalAiJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LocalAiJob_batchId_idx" ON "LocalAiJob"("batchId");
CREATE INDEX IF NOT EXISTS "LocalAiJob_status_createdAt_idx" ON "LocalAiJob"("status", "createdAt");
DO $$ BEGIN
    ALTER TABLE "LocalAiJob" ADD CONSTRAINT "LocalAiJob_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "LocalAiWorker"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

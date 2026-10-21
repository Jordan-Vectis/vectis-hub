CREATE TABLE IF NOT EXISTS "CustomerSyncState" (
    "phase" TEXT NOT NULL, "since" TIMESTAMP(3), "passStartedAt" TIMESTAMP(3), "passMode" TEXT,
    "nextLink" TEXT, "total" INTEGER, "done" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerSyncState_pkey" PRIMARY KEY ("phase")
  );

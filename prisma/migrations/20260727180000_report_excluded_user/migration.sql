-- A whole cataloguer hidden from the performance reports. Report-only, like
-- ReportExcludedDay — no log rows are touched, so it is restorable at any time.
CREATE TABLE IF NOT EXISTS "ReportExcludedUser" (
    "userId"         TEXT NOT NULL,
    "excludedById"   TEXT NOT NULL,
    "excludedByName" TEXT NOT NULL,
    "excludedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportExcludedUser_pkey" PRIMARY KEY ("userId")
);

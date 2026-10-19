CREATE TABLE IF NOT EXISTS "HomePageLayout" (
    "id"        TEXT NOT NULL DEFAULT 'global',
    "data"      JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    CONSTRAINT "HomePageLayout_pkey" PRIMARY KEY ("id")
);

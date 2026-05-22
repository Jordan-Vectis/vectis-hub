-- CreateTable
CREATE TABLE "IdleTimerConfig" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "yellowMins" INTEGER NOT NULL DEFAULT 4,
    "redMins" INTEGER NOT NULL DEFAULT 10,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdleTimerConfig_pkey" PRIMARY KEY ("id")
);

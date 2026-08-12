CREATE TABLE IF NOT EXISTS "FirstAider" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "roleTitle" TEXT, "location" TEXT, "phone" TEXT,
  "photoKey" TEXT, "sortOrder" INTEGER NOT NULL DEFAULT 0, "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FirstAider_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "FirstAidKit" (
  "id" TEXT NOT NULL, "kind" TEXT NOT NULL DEFAULT 'KIT', "label" TEXT NOT NULL, "whereText" TEXT,
  "photoKey" TEXT, "sortOrder" INTEGER NOT NULL DEFAULT 0, "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FirstAidKit_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "FirstAidInfo" (
  "id" TEXT NOT NULL DEFAULT 'global', "emergencySteps" TEXT, "siteAddress" TEXT,
  "assemblyPoint" TEXT, "extraNotes" TEXT, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FirstAidInfo_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "AccidentReport" (
  "id" TEXT NOT NULL, "reporterName" TEXT NOT NULL, "reporterPhone" TEXT, "injuredName" TEXT,
  "happenedAt" TEXT, "location" TEXT, "description" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NEW', "handledBy" TEXT, "handledAt" TIMESTAMP(3), "ipHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccidentReport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AccidentReport_createdAt_idx" ON "AccidentReport"("createdAt");
CREATE INDEX IF NOT EXISTS "AccidentReport_ipHash_createdAt_idx" ON "AccidentReport"("ipHash", "createdAt");

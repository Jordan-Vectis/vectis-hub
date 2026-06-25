-- CreateTable
CREATE TABLE "ConditionReport" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "fromName" TEXT,
    "fromEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "source" TEXT NOT NULL DEFAULT 'EMAIL',
    "graphMessageId" TEXT,
    "webLink" TEXT,
    "receivedAt" TIMESTAMP(3),
    "lotNumber" TEXT,
    "auctionId" TEXT,
    "auctionLabel" TEXT,
    "auctionDate" TIMESTAMP(3),
    "assignedToId" TEXT,
    "assignedToName" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConditionReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConditionMailboxAuth" (
    "id" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "connectedBy" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConditionMailboxAuth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConditionReport_graphMessageId_key" ON "ConditionReport"("graphMessageId");

-- CreateIndex
CREATE INDEX "ConditionReport_status_idx" ON "ConditionReport"("status");

-- CreateIndex
CREATE INDEX "ConditionReport_auctionId_idx" ON "ConditionReport"("auctionId");

-- CreateIndex
CREATE INDEX "ConditionReport_receivedAt_idx" ON "ConditionReport"("receivedAt");

-- AddForeignKey
ALTER TABLE "ConditionReport" ADD CONSTRAINT "ConditionReport_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "CatalogueAuction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

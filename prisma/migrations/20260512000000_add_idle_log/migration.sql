-- CreateTable
CREATE TABLE "IdleLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "idleStartedAt" TIMESTAMP(3) NOT NULL,
    "idleDurationMs" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "toteNumbers" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdleLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "IdleLog" ADD CONSTRAINT "IdleLog_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "CatalogueAuction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

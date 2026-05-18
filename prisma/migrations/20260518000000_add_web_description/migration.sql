-- CreateTable
CREATE TABLE "WebDescription" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "auctionCode" TEXT NOT NULL,
    "auctionName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebDescription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebDescription_auctionId_idx" ON "WebDescription"("auctionId");

-- AddForeignKey
ALTER TABLE "WebDescription" ADD CONSTRAINT "WebDescription_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "CatalogueAuction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

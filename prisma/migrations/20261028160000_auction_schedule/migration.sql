-- Auction → Auctioneering Schedule: the staff list, one schedule per sale, and the pinned weekly defaults.
CREATE TABLE IF NOT EXISTS "AuctionScheduleStaff" (
  "id"         TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "auctioneer" BOOLEAN NOT NULL DEFAULT false,
  "vectis"     BOOLEAN NOT NULL DEFAULT false,
  "saleroom"   BOOLEAN NOT NULL DEFAULT false,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuctionScheduleStaff_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "AuctionSchedule" (
  "auctionId" TEXT NOT NULL,
  "data"      JSONB NOT NULL,
  "updatedBy" TEXT NOT NULL DEFAULT '',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuctionSchedule_pkey" PRIMARY KEY ("auctionId")
);
CREATE TABLE IF NOT EXISTS "AuctionScheduleDefault" (
  "id"        TEXT NOT NULL,
  "data"      JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuctionScheduleDefault_pkey" PRIMARY KEY ("id")
);

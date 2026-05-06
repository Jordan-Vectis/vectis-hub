-- Add auctionName to WarehouseItem
-- Stores the human-readable sale name (e.g. "Kits & Aviation") resolved from
-- Auction_Lines_Excel via EVA_AuctionName, keyed by auctionCode.
ALTER TABLE "WarehouseItem" ADD COLUMN IF NOT EXISTS "auctionName" TEXT;

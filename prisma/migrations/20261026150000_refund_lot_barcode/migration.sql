-- Refunds: each lot's BC Internal Barcode and receipt number, pulled from BC with its hammer; which of
-- its boxes BC filled (a box typed in by hand is never replaced by a BC lookup); and whether BC's
-- receipt lines were read for it (a lot BC has no barcode for isn't offered again).
ALTER TABLE "RefundLot" ADD COLUMN IF NOT EXISTS "barcode" TEXT;
ALTER TABLE "RefundLot" ADD COLUMN IF NOT EXISTS "receiptNo" TEXT;
ALTER TABLE "RefundLot" ADD COLUMN IF NOT EXISTS "hammerFromBc" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RefundLot" ADD COLUMN IF NOT EXISTS "descriptionFromBc" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RefundLot" ADD COLUMN IF NOT EXISTS "refsRead" BOOLEAN NOT NULL DEFAULT false;

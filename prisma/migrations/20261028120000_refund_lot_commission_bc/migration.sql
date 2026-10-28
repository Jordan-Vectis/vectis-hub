-- Refunds: whether a lot's commission box holds what BC charged (the buyer's premium plus, for an
-- online bidder, the web premium, inc VAT) — a commission typed in by hand is never replaced by a lookup.
ALTER TABLE "RefundLot" ADD COLUMN IF NOT EXISTS "commissionFromBc" BOOLEAN NOT NULL DEFAULT false;

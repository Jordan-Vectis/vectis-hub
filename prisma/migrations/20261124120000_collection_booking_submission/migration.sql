-- Collection bookings: which CRM submission a booking was made from (its Logistics set to Collection).
ALTER TABLE "CollectionBooking" ADD COLUMN IF NOT EXISTS "submissionId" TEXT;
CREATE INDEX IF NOT EXISTS "CollectionBooking_submissionId_idx" ON "CollectionBooking"("submissionId");

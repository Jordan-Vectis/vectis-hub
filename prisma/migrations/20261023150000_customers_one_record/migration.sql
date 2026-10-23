-- One customer database (2026-10-23): Goods In and Submissions keyed to "Customer" instead of the old
-- CRM "Contact". Same statements as the MIGRATIONS array in lib/migrations.ts.
--
-- GoodsInCustomer / GoodsInAgreement are re-keyed (their one column renamed). Rows keyed on an old
-- contact id that is not a Customer are removed — there are none on production (0 Goods In customers,
-- 0 receipts); on staging and the sandbox they are test data from before.

ALTER TABLE "GoodsInReceipt" ADD COLUMN IF NOT EXISTS "customerId" TEXT;
ALTER TABLE "GoodsInReceipt" ALTER COLUMN "contactId" DROP NOT NULL;
CREATE INDEX IF NOT EXISTS "GoodsInReceipt_customerId_idx" ON "GoodsInReceipt"("customerId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GoodsInReceipt_customerId_fkey') THEN
    ALTER TABLE "GoodsInReceipt" ADD CONSTRAINT "GoodsInReceipt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "GoodsInCustomer" DROP CONSTRAINT IF EXISTS "GoodsInCustomer_contactId_fkey";
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'GoodsInCustomer' AND column_name = 'contactId') THEN
    ALTER TABLE "GoodsInCustomer" RENAME COLUMN "contactId" TO "customerId";
  END IF;
END $$;
DELETE FROM "GoodsInCustomer" WHERE "customerId" NOT IN (SELECT "id" FROM "Customer");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GoodsInCustomer_customerId_fkey') THEN
    ALTER TABLE "GoodsInCustomer" ADD CONSTRAINT "GoodsInCustomer_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "GoodsInAgreement" DROP CONSTRAINT IF EXISTS "GoodsInAgreement_contactId_fkey";
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'GoodsInAgreement' AND column_name = 'contactId') THEN
    ALTER TABLE "GoodsInAgreement" RENAME COLUMN "contactId" TO "customerId";
  END IF;
END $$;
DELETE FROM "GoodsInAgreement" WHERE "customerId" NOT IN (SELECT "id" FROM "Customer");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GoodsInAgreement_customerId_fkey') THEN
    ALTER TABLE "GoodsInAgreement" ADD CONSTRAINT "GoodsInAgreement_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "Submission" ADD COLUMN IF NOT EXISTS "customerId" TEXT;
ALTER TABLE "Submission" ALTER COLUMN "contactId" DROP NOT NULL;
CREATE INDEX IF NOT EXISTS "Submission_customerId_idx" ON "Submission"("customerId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Submission_customerId_fkey') THEN
    ALTER TABLE "Submission" ADD CONSTRAINT "Submission_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

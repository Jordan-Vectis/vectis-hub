-- Customers → Notes & calls, and the indexes the customer list and page read by (2026-10-23).
-- Same statements as the MIGRATIONS array in lib/migrations.ts.

CREATE TABLE IF NOT EXISTS "CustomerNote" (
    "id"           TEXT NOT NULL,
    "customerId"   TEXT NOT NULL,
    "kind"         TEXT NOT NULL DEFAULT 'note',
    "text"         TEXT NOT NULL,
    "followUpAt"   TIMESTAMP(3),
    "followUpDone" BOOLEAN NOT NULL DEFAULT false,
    "byId"         TEXT,
    "byName"       TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerNote_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CustomerNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE
  );

CREATE INDEX IF NOT EXISTS "CustomerNote_customerId_createdAt_idx" ON "CustomerNote"("customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "CustomerNote_followUpAt_idx" ON "CustomerNote"("followUpAt");

CREATE INDEX IF NOT EXISTS "Customer_contactNo_idx" ON "Customer"("contactNo");
CREATE INDEX IF NOT EXISTS "Customer_vendorNo_idx" ON "Customer"("vendorNo");
CREATE INDEX IF NOT EXISTS "Customer_buyerNo_idx" ON "Customer"("buyerNo");
CREATE INDEX IF NOT EXISTS "WarehouseItem_vendorNo_idx" ON "WarehouseItem"("vendorNo");
CREATE INDEX IF NOT EXISTS "WarehouseReceiptTote_vendorNo_idx" ON "WarehouseReceiptTote"("vendorNo");
CREATE INDEX IF NOT EXISTS "WarehouseTote_vendorNo_idx" ON "WarehouseTote"("vendorNo");
CREATE INDEX IF NOT EXISTS "CatalogueLot_vendor_idx" ON "CatalogueLot"("vendor");

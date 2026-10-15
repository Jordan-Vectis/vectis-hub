-- Goods In (2026-10-15): the Hub's own check-in. Same statements as the MIGRATIONS array in lib/migrations.ts.

CREATE TABLE IF NOT EXISTS "GoodsInCustomer" (
    "contactId"      TEXT NOT NULL,
    "vendorNo"       TEXT,
    "mobile"         TEXT,
    "town"           TEXT,
    "county"         TEXT,
    "country"        TEXT,
    "vatRegNo"       TEXT,
    "commission"     DOUBLE PRECISION,
    "lottingFee"     DOUBLE PRECISION,
    "photographyFee" DOUBLE PRECISION,
    "unsoldFee"      DOUBLE PRECISION,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoodsInCustomer_pkey" PRIMARY KEY ("contactId")
  );

CREATE UNIQUE INDEX IF NOT EXISTS "GoodsInCustomer_vendorNo_key" ON "GoodsInCustomer"("vendorNo");

DO $$ BEGIN
    ALTER TABLE "GoodsInCustomer" ADD CONSTRAINT "GoodsInCustomer_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "GoodsInReceipt" (
    "id"             TEXT NOT NULL,
    "contactId"      TEXT NOT NULL,
    "vendorNo"       TEXT,
    "customer"       JSONB,
    "commission"     DOUBLE PRECISION,
    "lottingFee"     DOUBLE PRECISION,
    "photographyFee" DOUBLE PRECISION,
    "unsoldFee"      DOUBLE PRECISION,
    "reservePercent" INTEGER,
    "ownerConfirmed" BOOLEAN,
    "agentConfirmed" BOOLEAN,
    "notes"          TEXT,
    "status"         TEXT,
    "createdById"    TEXT,
    "createdByName"  TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "printedAt"      TIMESTAMP(3),
    "emailedAt"      TIMESTAMP(3),
    "emailedTo"      TEXT,
    CONSTRAINT "GoodsInReceipt_pkey" PRIMARY KEY ("id")
  );

CREATE INDEX IF NOT EXISTS "GoodsInReceipt_contactId_idx" ON "GoodsInReceipt"("contactId");

CREATE INDEX IF NOT EXISTS "GoodsInReceipt_createdAt_idx" ON "GoodsInReceipt"("createdAt");

DO $$ BEGIN
    ALTER TABLE "GoodsInReceipt" ADD CONSTRAINT "GoodsInReceipt_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "GoodsInContainer" (
    "id"             TEXT NOT NULL,
    "receiptId"      TEXT NOT NULL,
    "kind"           TEXT NOT NULL,
    "category"       TEXT,
    "description"    TEXT,
    "status"         TEXT,
    "locationCode"   TEXT,
    "locationKind"   TEXT,
    "movedAt"        TIMESTAMP(3),
    "labelPrintedAt" TIMESTAMP(3),
    "createdByName"  TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoodsInContainer_pkey" PRIMARY KEY ("id")
  );

CREATE INDEX IF NOT EXISTS "GoodsInContainer_receiptId_idx" ON "GoodsInContainer"("receiptId");

CREATE INDEX IF NOT EXISTS "GoodsInContainer_locationCode_idx" ON "GoodsInContainer"("locationCode");

CREATE INDEX IF NOT EXISTS "GoodsInContainer_status_idx" ON "GoodsInContainer"("status");

DO $$ BEGIN
    ALTER TABLE "GoodsInContainer" ADD CONSTRAINT "GoodsInContainer_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsInReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "GoodsInLocation" (
    "code"      TEXT NOT NULL,
    "name"      TEXT,
    "kind"      TEXT,
    "active"    BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoodsInLocation_pkey" PRIMARY KEY ("code")
  );

CREATE TABLE IF NOT EXISTS "GoodsInMovement" (
    "id"           TEXT NOT NULL,
    "containerId"  TEXT,
    "lotId"        TEXT,
    "barcode"      TEXT,
    "locationCode" TEXT NOT NULL,
    "fromCode"     TEXT,
    "note"         TEXT,
    "movedById"    TEXT,
    "movedByName"  TEXT,
    "movedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoodsInMovement_pkey" PRIMARY KEY ("id")
  );

CREATE INDEX IF NOT EXISTS "GoodsInMovement_containerId_movedAt_idx" ON "GoodsInMovement"("containerId", "movedAt");

CREATE INDEX IF NOT EXISTS "GoodsInMovement_lotId_movedAt_idx" ON "GoodsInMovement"("lotId", "movedAt");

CREATE INDEX IF NOT EXISTS "GoodsInMovement_barcode_idx" ON "GoodsInMovement"("barcode");

CREATE INDEX IF NOT EXISTS "GoodsInMovement_locationCode_idx" ON "GoodsInMovement"("locationCode");

DO $$ BEGIN
    ALTER TABLE "GoodsInMovement" ADD CONSTRAINT "GoodsInMovement_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "GoodsInContainer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "GoodsInCounter" (
    "key"       TEXT NOT NULL,
    "prefix"    TEXT NOT NULL,
    "next"      INTEGER NOT NULL,
    "width"     INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    CONSTRAINT "GoodsInCounter_pkey" PRIMARY KEY ("key")
  );

CREATE TABLE IF NOT EXISTS "GoodsInMailAuth" (
    "id"           TEXT NOT NULL,
    "mailbox"      TEXT,
    "accessToken"  TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt"    TIMESTAMP(3) NOT NULL,
    "connectedBy"  TEXT,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoodsInMailAuth_pkey" PRIMARY KEY ("id")
  );

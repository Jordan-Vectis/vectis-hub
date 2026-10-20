CREATE TABLE IF NOT EXISTS "Customer" (
    "id" TEXT NOT NULL,
    "contactNo" TEXT, "vendorNo" TEXT, "buyerNo" TEXT,
    "name" TEXT, "name2" TEXT, "email" TEXT, "email2" TEXT, "phone" TEXT, "mobile" TEXT, "mobile2" TEXT,
    "address" TEXT, "address2" TEXT, "address3" TEXT, "city" TEXT, "county" TEXT, "postCode" TEXT, "countryCode" TEXT,
    "vatRegNo" TEXT, "eoriNumber" TEXT, "currencyCode" TEXT, "blocked" TEXT, "websiteId" TEXT,
    "paddleNo" TEXT, "permanentPaddleNo" TEXT, "permanentBuyer" BOOLEAN, "trustedBuyer" BOOLEAN,
    "preferentialTelephoneBuyer" BOOLEAN, "privateTrade" TEXT, "buyerPremiumDiscPct" DOUBLE PRECISION,
    "doNotEmailResults" BOOLEAN, "doNotChargeStdDelivery" BOOLEAN,
    "bcContact" JSONB, "bcVendor" JSONB, "bcBuyer" JSONB, "bcWeb" JSONB,
    "bcCreatedAt" TIMESTAMP(3), "bcModifiedAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'bc', "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
  );

CREATE UNIQUE INDEX IF NOT EXISTS "Customer_contactNo_key" ON "Customer"("contactNo");

CREATE UNIQUE INDEX IF NOT EXISTS "Customer_vendorNo_key" ON "Customer"("vendorNo");

CREATE UNIQUE INDEX IF NOT EXISTS "Customer_buyerNo_key" ON "Customer"("buyerNo");

CREATE INDEX IF NOT EXISTS "Customer_email_idx" ON "Customer"("email");

CREATE INDEX IF NOT EXISTS "Customer_postCode_idx" ON "Customer"("postCode");

CREATE INDEX IF NOT EXISTS "Customer_name_idx" ON "Customer"("name");

CREATE TABLE IF NOT EXISTS "CustomerShipTo" (
    "id" TEXT NOT NULL, "bcSystemId" TEXT NOT NULL, "buyerNo" TEXT NOT NULL, "customerId" TEXT,
    "code" TEXT, "name" TEXT, "name2" TEXT, "address" TEXT, "address2" TEXT, "city" TEXT, "county" TEXT,
    "postCode" TEXT, "countryCode" TEXT, "email" TEXT, "phone" TEXT, "bc" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerShipTo_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CustomerShipTo_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE
  );

CREATE UNIQUE INDEX IF NOT EXISTS "CustomerShipTo_bcSystemId_key" ON "CustomerShipTo"("bcSystemId");

CREATE INDEX IF NOT EXISTS "CustomerShipTo_buyerNo_idx" ON "CustomerShipTo"("buyerNo");

CREATE INDEX IF NOT EXISTS "CustomerShipTo_customerId_idx" ON "CustomerShipTo"("customerId");

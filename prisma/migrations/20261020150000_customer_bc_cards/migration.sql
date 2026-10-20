CREATE TABLE IF NOT EXISTS "CustomerBcCard" (
    "customerId" TEXT NOT NULL, "contactCard" JSONB, "vendorCard" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerBcCard_pkey" PRIMARY KEY ("customerId"),
    CONSTRAINT "CustomerBcCard_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE
  );

-- Departments carry the auction types they cover — the link between a sale and
-- the people allowed to work on it.
ALTER TABLE "Department" ADD COLUMN IF NOT EXISTS "auctionTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- People <-> departments, many-to-many (a cataloguer can cover more than one).
CREATE TABLE IF NOT EXISTS "UserDepartment" (
    "userId"       TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserDepartment_pkey" PRIMARY KEY ("userId", "departmentId")
);
CREATE INDEX IF NOT EXISTS "UserDepartment_departmentId_idx" ON "UserDepartment"("departmentId");

DO $$ BEGIN
    ALTER TABLE "UserDepartment" ADD CONSTRAINT "UserDepartment_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "UserDepartment" ADD CONSTRAINT "UserDepartment_departmentId_fkey"
        FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Carry the old single User.departmentId across so nobody loses their department.
INSERT INTO "UserDepartment" ("userId", "departmentId")
SELECT "id", "departmentId" FROM "User" WHERE "departmentId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- One-off access to a single sale for someone outside its department.
CREATE TABLE IF NOT EXISTS "CatalogueAuctionAccess" (
    "id"        TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "grantedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CatalogueAuctionAccess_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CatalogueAuctionAccess_auctionId_userId_key" ON "CatalogueAuctionAccess"("auctionId", "userId");
CREATE INDEX IF NOT EXISTS "CatalogueAuctionAccess_userId_idx" ON "CatalogueAuctionAccess"("userId");

DO $$ BEGIN
    ALTER TABLE "CatalogueAuctionAccess" ADD CONSTRAINT "CatalogueAuctionAccess_auctionId_fkey"
        FOREIGN KEY ("auctionId") REFERENCES "CatalogueAuction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "CatalogueAuctionAccess" ADD CONSTRAINT "CatalogueAuctionAccess_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

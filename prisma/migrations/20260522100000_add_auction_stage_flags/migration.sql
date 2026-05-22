ALTER TABLE "CatalogueAuction" ADD COLUMN "catalogued"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CatalogueAuction" ADD COLUMN "addedToBC"   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CatalogueAuction" ADD COLUMN "photography" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CatalogueAuction" ADD COLUMN "aiRan"       BOOLEAN NOT NULL DEFAULT false;

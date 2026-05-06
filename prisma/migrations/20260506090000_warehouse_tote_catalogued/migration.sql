-- AlterTable: drop unused columns, add catalogued
ALTER TABLE "WarehouseTote" DROP COLUMN IF EXISTS "binCode";
ALTER TABLE "WarehouseTote" DROP COLUMN IF EXISTS "bcModifiedAt";
ALTER TABLE "WarehouseTote" ADD COLUMN "catalogued" BOOLEAN;

-- CreateIndex
CREATE INDEX "WarehouseTote_catalogued_idx" ON "WarehouseTote"("catalogued");

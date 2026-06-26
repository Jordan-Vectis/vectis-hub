-- AlterTable
ALTER TABLE "ConditionReport" ADD COLUMN     "auctionCode" TEXT;
ALTER TABLE "ConditionReport" ADD COLUMN     "cataloguerCode" TEXT;
ALTER TABLE "ConditionReport" ADD COLUMN     "cataloguerName" TEXT;
ALTER TABLE "ConditionReport" ADD COLUMN     "cataloguerEmail" TEXT;
ALTER TABLE "ConditionReport" ADD COLUMN     "notifiedAt" TIMESTAMP(3);

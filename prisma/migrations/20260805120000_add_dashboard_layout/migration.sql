-- CreateTable
CREATE TABLE IF NOT EXISTS "DashboardLayout" (
    "userId"    TEXT NOT NULL,
    "widgets"   JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardLayout_pkey" PRIMARY KEY ("userId")
);

-- AlterTable
ALTER TABLE "RoleDefault" ADD COLUMN IF NOT EXISTS "dashboardWidgets" JSONB;

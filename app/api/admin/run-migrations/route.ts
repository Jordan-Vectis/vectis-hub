import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// POST /api/admin/run-migrations
// Runs any missing column additions directly via SQL.
// Safe to call multiple times — all statements use IF NOT EXISTS.

const MIGRATIONS = [
  `ALTER TABLE "CatalogueLot" ADD COLUMN IF NOT EXISTS "extraDetails" TEXT`,
  `CREATE TABLE IF NOT EXISTS "RoleDefault" (
    "role"           TEXT NOT NULL,
    "allowedApps"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "appPermissions" JSONB,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RoleDefault_pkey" PRIMARY KEY ("role")
  )`,
  `CREATE TABLE IF NOT EXISTS "Device" (
    "id"           TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "deviceType"   TEXT NOT NULL DEFAULT 'iPad',
    "notes"        TEXT,
    "assignedToId" TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "Device_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Device_serialNumber_key" UNIQUE ("serialNumber")
  )`,
  `CREATE TABLE IF NOT EXISTS "ClaudeMemory" (
    "filename"  TEXT NOT NULL,
    "content"   TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "ClaudeMemory_pkey" PRIMARY KEY ("filename")
  )`,
  `CREATE TABLE IF NOT EXISTS "MarketingDraft" (
    "id"            TEXT NOT NULL,
    "title"         TEXT NOT NULL,
    "contentType"   TEXT NOT NULL,
    "content"       TEXT NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'DRAFT',
    "publishedUrl"  TEXT,
    "createdById"   TEXT,
    "createdByName" TEXT,
    "lotsSnapshot"  JSONB,
    "notes"         TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "MarketingDraft_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "MarketingHashtag" (
    "id"        TEXT NOT NULL,
    "category"  TEXT NOT NULL,
    "hashtags"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "MarketingHashtag_pkey" PRIMARY KEY ("id")
  )`,
  // BC cataloguing-report cache: split into two modes (barcode | uniqueid).
  // Existing rows keep their default 'barcode' value, no data loss.
  `ALTER TABLE "BCCatalogueDay"   ADD COLUMN IF NOT EXISTS "mode" TEXT NOT NULL DEFAULT 'barcode'`,
  `ALTER TABLE "BCCatalogueEntry" ADD COLUMN IF NOT EXISTS "mode" TEXT NOT NULL DEFAULT 'barcode'`,
  `ALTER TABLE "BCCatalogueDay"   DROP CONSTRAINT IF EXISTS "BCCatalogueDay_pkey"`,
  `ALTER TABLE "BCCatalogueEntry" DROP CONSTRAINT IF EXISTS "BCCatalogueEntry_pkey"`,
  `ALTER TABLE "BCCatalogueDay"   ADD CONSTRAINT "BCCatalogueDay_pkey"   PRIMARY KEY ("date", "mode")`,
  `ALTER TABLE "BCCatalogueEntry" ADD CONSTRAINT "BCCatalogueEntry_pkey" PRIMARY KEY ("date", "userId", "mode")`,
]

export async function POST() {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const results: string[] = []
    for (const sql of MIGRATIONS) {
      await prisma.$executeRawUnsafe(sql)
      results.push(`OK: ${sql.slice(0, 60)}…`)
    }

    return NextResponse.json({ ok: true, results })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

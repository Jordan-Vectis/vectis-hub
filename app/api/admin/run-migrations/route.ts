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
  // CatalogueLot.addedToBC — manual cataloguer tick once a lot has gone over to BC
  `ALTER TABLE "CatalogueLot" ADD COLUMN IF NOT EXISTS "addedToBC" BOOLEAN NOT NULL DEFAULT FALSE`,

  // Packer — packing-floor staff list, used to generate the barcode sheet
  `CREATE TABLE IF NOT EXISTS "Packer" (
    "id"          TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "staffGroup"  TEXT NOT NULL DEFAULT 'FULL_TIME',
    "active"      BOOLEAN NOT NULL DEFAULT TRUE,
    "sortOrder"   INTEGER NOT NULL DEFAULT 0,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "Packer_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "Packer_staffGroup_idx" ON "Packer"("staffGroup")`,
  `ALTER TABLE "Packer" ADD COLUMN IF NOT EXISTS "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`,

  // User.role: convert from enum Role → TEXT so admins can add custom roles.
  // Existing enum values ('ADMIN', 'COLLECTIONS', 'CATALOGUER') survive
  // unchanged as their text equivalents. The old "Role" enum type stays
  // in the DB (harmless) so we don't need a DROP TYPE.
  // The DO block makes it idempotent — repeats just check the column type.
  `DO $$
   BEGIN
     IF EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'User' AND column_name = 'role' AND udt_name = 'Role'
     ) THEN
       ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
       ALTER TABLE "User" ALTER COLUMN "role" TYPE TEXT USING role::text;
       ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'COLLECTIONS';
     END IF;
   END $$`,

  // Ticket — IT problem / feature request log
  `CREATE TABLE IF NOT EXISTS "Ticket" (
    "id"             TEXT NOT NULL,
    "title"          TEXT NOT NULL,
    "description"    TEXT NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'OPEN',
    "priority"       TEXT NOT NULL DEFAULT 'MEDIUM',
    "category"       TEXT NOT NULL DEFAULT 'OTHER',
    "createdById"    TEXT,
    "createdByName"  TEXT NOT NULL,
    "assignedToId"   TEXT,
    "assignedToName" TEXT,
    "resolvedAt"     TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "Ticket_status_idx"    ON "Ticket"("status")`,
  `CREATE INDEX IF NOT EXISTS "Ticket_priority_idx"  ON "Ticket"("priority")`,
  `CREATE INDEX IF NOT EXISTS "Ticket_createdAt_idx" ON "Ticket"("createdAt")`,

  // KnowledgeArticle — IT solutions & how-tos for the IT Help chatbot
  `CREATE TABLE IF NOT EXISTS "KnowledgeArticle" (
    "id"            TEXT NOT NULL,
    "title"         TEXT NOT NULL,
    "body"          TEXT NOT NULL,
    "tags"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "category"      TEXT NOT NULL DEFAULT 'GENERAL',
    "createdById"   TEXT,
    "createdByName" TEXT NOT NULL,
    "updatedById"   TEXT,
    "updatedByName" TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "KnowledgeArticle_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "KnowledgeArticle_category_idx"  ON "KnowledgeArticle"("category")`,
  `CREATE INDEX IF NOT EXISTS "KnowledgeArticle_updatedAt_idx" ON "KnowledgeArticle"("updatedAt")`,

  // TicketCategory — user-managed list. Seed the six defaults if the table is
  // empty so existing tickets keep displaying nicely.
  `CREATE TABLE IF NOT EXISTS "TicketCategory" (
    "id"        TEXT NOT NULL,
    "key"       TEXT NOT NULL,
    "label"     TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active"    BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "TicketCategory_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TicketCategory_key_key" UNIQUE ("key")
  )`,
  `INSERT INTO "TicketCategory" ("id", "key", "label", "sortOrder", "updatedAt")
   VALUES
     ('seed_hardware',        'HARDWARE',        'Hardware',        10, NOW()),
     ('seed_software',        'SOFTWARE',        'Software',        20, NOW()),
     ('seed_network',         'NETWORK',         'Network',         30, NOW()),
     ('seed_app_bug',         'APP_BUG',         'App bug',         40, NOW()),
     ('seed_feature_request', 'FEATURE_REQUEST', 'Feature request', 50, NOW()),
     ('seed_other',           'OTHER',           'Other',           60, NOW())
   ON CONFLICT ("key") DO NOTHING`,
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

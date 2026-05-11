import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export const maxDuration = 30

// GET /api/databases/browse?table=NAME[&search=...&limit=500&offset=0]
//
// Generic table-viewer endpoint backing the "Browse Any Table" tab on
// /databases. Returns up to `limit` rows from any whitelisted model.
// Search does a case-insensitive contains across the model's string fields.
//
// Each entry in the whitelist maps a friendly key to:
//   - the Prisma model delegate
//   - a description shown in the picker
//   - the field list to project (skip blobs/passwords/etc.)
//   - the default sort order
//   - the list of fields that text search scans

type ModelKey =
  | "submissions" | "items" | "valuations" | "contactLogs"
  | "auctionRuns" | "auctionLots" | "aiPresets" | "logistics"
  | "catalogueAuctions" | "bidderRegistrations" | "liveAuctions"
  | "catalogueTimingLogs" | "cataloguePhotoSessions" | "appCards"
  | "marketingDrafts" | "marketingHashtags"
  | "warehouseLocations" | "warehouseMovements"
  | "parcels" | "parcelLots" | "macroFiles" | "heroSlides" | "researchLogs"
  | "customerAccounts" | "departments" | "roleDefaults" | "devices" | "claudeMemory"
  | "bcCatalogueDays" | "bcCatalogueEntries" | "bcPackingDays" | "bcPackingEntries"
  | "warehouseItems" | "warehouseTotes" | "warehouseSyncLogs"
  // Already exposed via bespoke tabs but included here for the overview
  | "contacts" | "warehouseReceipts" | "warehouseContainers"
  | "catalogueLots" | "commissionBids"
  // Sensitive — only safe columns are projected
  | "users" | "bcTokens"

type WhitelistEntry = {
  label:      string
  group:      string
  description: string
  delegate:   any
  select?:    Record<string, true>
  orderBy?:   any
  searchFields: string[]
}

function buildWhitelist(): Record<ModelKey, WhitelistEntry> {
  return {
    // ── Submissions / Valuation pipeline ────────────────────────────────
    submissions: {
      label: "Submissions",
      group: "Submissions / Valuation",
      description: "Items submitted by potential vendors awaiting valuation/collection",
      delegate: prisma.submission,
      orderBy: { createdAt: "desc" },
      searchFields: ["customerName", "customerEmail", "channel", "status", "notes"],
    },
    items: {
      label: "Submission Items",
      group: "Submissions / Valuation",
      description: "Individual items within submissions",
      delegate: prisma.item,
      orderBy: { createdAt: "desc" },
      searchFields: ["description", "category", "notes"],
    },
    valuations: {
      label: "Valuations",
      group: "Submissions / Valuation",
      description: "Valuation records on submissions",
      delegate: prisma.valuation,
      orderBy: { createdAt: "desc" },
      searchFields: ["notes"],
    },
    contactLogs: {
      label: "Contact Log",
      group: "Submissions / Valuation",
      description: "Communication history with submitters",
      delegate: prisma.contactLog,
      orderBy: { createdAt: "desc" },
      searchFields: ["channel", "summary", "notes"],
    },

    // ── AI auction runs ──────────────────────────────────────────────
    auctionRuns: {
      label: "AI Auction Runs",
      group: "AI Cataloguing",
      description: "Saved AI batch-run sessions",
      delegate: prisma.auctionRun,
      orderBy: { createdAt: "desc" },
      searchFields: ["name", "auctionCode", "createdByName"],
    },
    auctionLots: {
      label: "AI Run Lots",
      group: "AI Cataloguing",
      description: "Individual lots inside saved AI runs",
      delegate: prisma.auctionLot,
      orderBy: { createdAt: "desc" },
      searchFields: ["barcode", "title", "description"],
    },
    aiPresets: {
      label: "AI Presets",
      group: "AI Cataloguing",
      description: "Saved prompt presets used by the AI cataloguing tools",
      delegate: prisma.aiPreset,
      orderBy: { updatedAt: "desc" },
      searchFields: ["name", "category"],
    },
    cataloguePhotoSessions: {
      label: "Photo Sessions",
      group: "AI Cataloguing",
      description: "Photo upload sessions during cataloguing",
      delegate: prisma.cataloguePhotoSession,
      orderBy: { startedAt: "desc" },
      searchFields: ["userName"],
    },
    catalogueTimingLogs: {
      label: "Cataloguing Timing",
      group: "AI Cataloguing",
      description: "How long each lot took per cataloguer",
      delegate: prisma.catalogueTimingLog,
      orderBy: { savedAt: "desc" },
      searchFields: ["userName", "lotNumber", "method"],
    },
    researchLogs: {
      label: "Research Sessions",
      group: "AI Cataloguing",
      description: "Time spent on the Research page",
      delegate: prisma.researchLog,
      orderBy: { savedAt: "desc" },
      searchFields: ["userName"],
    },

    // ── Cataloguing core ───────────────────────────────────────────────
    catalogueAuctions: {
      label: "Auctions",
      group: "Cataloguing",
      description: "Auction headers — every catalogued sale",
      delegate: prisma.catalogueAuction,
      orderBy: { createdAt: "desc" },
      searchFields: ["code", "name", "auctionType", "notes"],
    },
    bidderRegistrations: {
      label: "Bidder Registrations",
      group: "Cataloguing",
      description: "Customers registered to bid in each auction",
      delegate: prisma.bidderRegistration,
      orderBy: { registeredAt: "desc" },
      searchFields: [],
    },
    liveAuctions: {
      label: "Live Auctions",
      group: "Cataloguing",
      description: "Live-auction sessions",
      delegate: prisma.liveAuction,
      orderBy: { createdAt: "desc" },
      searchFields: [],
    },

    // ── Warehouse / logistics ─────────────────────────────────────────
    logistics: {
      label: "Logistics",
      group: "Warehouse / Logistics",
      description: "Collection/shipping records",
      delegate: prisma.logistics,
      orderBy: { createdAt: "desc" },
      searchFields: ["type", "courier", "address", "notes", "status"],
    },
    warehouseLocations: {
      label: "Warehouse Locations",
      group: "Warehouse / Logistics",
      description: "Master list of valid storage locations",
      delegate: prisma.warehouseLocation,
      orderBy: { code: "asc" },
      searchFields: ["code", "name"],
    },
    warehouseMovements: {
      label: "Movements",
      group: "Warehouse / Logistics",
      description: "Container location-change history",
      delegate: prisma.warehouseMovement,
      orderBy: { movedAt: "desc" },
      searchFields: ["locationCode", "movedByName", "notes"],
    },
    parcels: {
      label: "Parcels",
      group: "Warehouse / Logistics",
      description: "Outbound parcels (post-sale dispatch)",
      delegate: prisma.parcel,
      orderBy: { createdAt: "desc" },
      searchFields: ["status", "courier", "trackingNumber"],
    },
    parcelLots: {
      label: "Parcel Lots",
      group: "Warehouse / Logistics",
      description: "Which lots are in which parcel",
      delegate: prisma.parcelLot,
      orderBy: { id: "desc" },
      searchFields: [],
    },
    macroFiles: {
      label: "Macro Files",
      group: "Warehouse / Logistics",
      description: "Generated BC macro export files",
      delegate: prisma.macroFile,
      orderBy: { createdAt: "desc" },
      searchFields: ["filename", "kind"],
    },

    // ── BC sync caches ───────────────────────────────────────────────
    warehouseItems: {
      label: "BC Warehouse Items",
      group: "BC Sync Cache",
      description: "Items synced from Business Central (read by /tools/bc-warehouse)",
      delegate: prisma.warehouseItem,
      orderBy: { updatedAt: "desc" },
      searchFields: ["uniqueId", "barcode", "description", "auctionCode", "vendorName", "location"],
    },
    warehouseTotes: {
      label: "BC Warehouse Totes",
      group: "BC Sync Cache",
      description: "Totes synced from Business Central",
      delegate: prisma.warehouseTote,
      orderBy: { updatedAt: "desc" },
      searchFields: ["toteNo", "vendorName", "location"],
    },
    warehouseSyncLogs: {
      label: "Sync Log",
      group: "BC Sync Cache",
      description: "Per-source sync history with timing and error info",
      delegate: prisma.warehouseSyncLog,
      orderBy: { startedAt: "desc" },
      searchFields: ["source", "status"],
    },
    bcCatalogueDays: {
      label: "BC Catalogue Days",
      group: "BC Sync Cache",
      description: "Per-date cache markers for the cataloguing report",
      delegate: prisma.bCCatalogueDay,
      orderBy: { date: "desc" },
      searchFields: ["mode"],
    },
    bcCatalogueEntries: {
      label: "BC Catalogue Entries",
      group: "BC Sync Cache",
      description: "Per-day per-user counts for the cataloguing report",
      delegate: prisma.bCCatalogueEntry,
      orderBy: { date: "desc" },
      searchFields: ["userId", "mode"],
    },
    bcPackingDays: {
      label: "BC Packing Days",
      group: "BC Sync Cache",
      description: "Per-date cache markers for the packing report",
      delegate: prisma.bCPackingDay,
      orderBy: { date: "desc" },
      searchFields: [],
    },
    bcPackingEntries: {
      label: "BC Packing Entries",
      group: "BC Sync Cache",
      description: "Per-day per-user counts for the packing report",
      delegate: prisma.bCPackingEntry,
      orderBy: { date: "desc" },
      searchFields: ["userId"],
    },

    // ── Marketing ────────────────────────────────────────────────────
    marketingDrafts: {
      label: "Marketing Drafts",
      group: "Marketing",
      description: "Saved articles, emails, social posts from BC Marketing",
      delegate: prisma.marketingDraft,
      orderBy: { updatedAt: "desc" },
      searchFields: ["title", "contentType", "status", "createdByName"],
    },
    marketingHashtags: {
      label: "Hashtag Banks",
      group: "Marketing",
      description: "Curated hashtag sets per category",
      delegate: prisma.marketingHashtag,
      orderBy: { category: "asc" },
      searchFields: ["category"],
    },
    heroSlides: {
      label: "Hero Slides",
      group: "Marketing",
      description: "Homepage hero slides",
      delegate: prisma.heroSlide,
      orderBy: { createdAt: "desc" },
      searchFields: ["title", "subtitle", "cta"],
    },

    // ── Customer accounts (public-side) ──────────────────────────────
    customerAccounts: {
      label: "Customer Accounts",
      group: "Customers",
      description: "Public-site customer login accounts",
      delegate: prisma.customerAccount,
      select: {
        // Don't expose hashed passwords
        id: true, email: true, firstName: true, lastName: true,
        phone: true, contactId: true, verified: true,
        createdAt: true, updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
      searchFields: ["email", "firstName", "lastName", "phone"],
    },

    // ── Already in bespoke tabs (included here for overview only) ─────
    contacts: {
      label: "Contacts (Customers)",
      group: "Customers",
      description: "Master contacts — also editable on the Customers tab",
      delegate: prisma.contact,
      orderBy: { name: "asc" },
      searchFields: ["name", "email", "phone", "notes"],
    },
    warehouseReceipts: {
      label: "Warehouse Receipts",
      group: "Warehouse / Logistics",
      description: "Vendor receipts — also editable on the Receipts tab",
      delegate: prisma.warehouseReceipt,
      orderBy: { createdAt: "desc" },
      searchFields: ["status", "notes"],
    },
    warehouseContainers: {
      label: "Warehouse Containers (Totes)",
      group: "Warehouse / Logistics",
      description: "Tote containers — also editable on the Totes tab",
      delegate: prisma.warehouseContainer,
      orderBy: { createdAt: "desc" },
      searchFields: ["type", "description", "category", "subcategory"],
    },
    catalogueLots: {
      label: "Catalogue Lots",
      group: "Cataloguing",
      description: "Catalogued lots — also editable on the Lots tab",
      delegate: prisma.catalogueLot,
      orderBy: { createdAt: "desc" },
      searchFields: ["lotNumber", "title", "description", "barcode", "vendor", "category", "status"],
    },
    commissionBids: {
      label: "Commission Bids",
      group: "Cataloguing",
      description: "Pre-auction commission bids — also viewable on the Bids tab",
      delegate: prisma.commissionBid,
      orderBy: { placedAt: "desc" },
      searchFields: [],
    },

    // ── Sensitive — only safe fields projected ─────────────────────────
    users: {
      label: "Users (staff logins)",
      group: "Admin",
      description: "Staff login accounts — password fields are deliberately hidden",
      delegate: prisma.user,
      select: {
        id: true, name: true, email: true, username: true,
        role: true, departmentId: true,
        allowedApps: true, appPermissions: true,
        createdAt: true, updatedAt: true,
      },
      orderBy: { name: "asc" },
      searchFields: ["name", "email", "username", "role"],
    },
    bcTokens: {
      label: "BC OAuth Tokens",
      group: "Admin",
      description: "Business Central OAuth state — token bodies are deliberately hidden",
      delegate: prisma.bCToken,
      select: {
        userId: true, expiresAt: true, refreshExpiresAt: true,
        createdAt: true, updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      searchFields: [],
    },

    // ── Admin-managed ────────────────────────────────────────────────
    departments: {
      label: "Departments",
      group: "Admin",
      description: "Cataloguer departments",
      delegate: prisma.department,
      orderBy: { name: "asc" },
      searchFields: ["name"],
    },
    roleDefaults: {
      label: "Role Defaults",
      group: "Admin",
      description: "Default app access + permissions per role",
      delegate: prisma.roleDefault,
      orderBy: { role: "asc" },
      searchFields: ["role"],
    },
    devices: {
      label: "Devices",
      group: "Admin",
      description: "Tracked tablets/laptops assigned to staff",
      delegate: prisma.device,
      orderBy: { name: "asc" },
      searchFields: ["serialNumber", "name", "deviceType", "notes"],
    },
    appCards: {
      label: "App Cards",
      group: "Admin",
      description: "Hub-page card overrides (labels, ordering, visibility)",
      delegate: prisma.appCard,
      orderBy: { sortOrder: "asc" },
      searchFields: ["key", "label", "description"],
    },
    claudeMemory: {
      label: "Claude Memory",
      group: "Admin",
      description: "Memory files surfaced to Claude across sessions",
      delegate: prisma.claudeMemory,
      orderBy: { updatedAt: "desc" },
      searchFields: ["filename"],
    },
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { searchParams } = req.nextUrl
    const tableKey = searchParams.get("table")?.trim() as ModelKey | null
    const search   = searchParams.get("search")?.trim() ?? ""
    const limit    = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "500", 10) || 500, 1), 2000)
    const offset   = Math.max(parseInt(searchParams.get("offset") ?? "0", 10) || 0, 0)

    const whitelist = buildWhitelist()

    const overview = searchParams.get("overview") === "1"

    if (overview) {
      // Return every table with its row count + a small sample (default 3 rows).
      // Runs all the queries in parallel so the response stays snappy even with
      // 30+ tables. Errors per-table fall through to count=null so one bad
      // model doesn't break the whole overview.
      const sampleSize = Math.min(Math.max(parseInt(searchParams.get("sampleSize") ?? "3", 10) || 3, 1), 10)
      const entries = Object.entries(whitelist) as [ModelKey, WhitelistEntry][]
      const results = await Promise.all(entries.map(async ([key, v]) => {
        try {
          const [count, rows] = await Promise.all([
            v.delegate.count(),
            v.delegate.findMany({
              ...(v.select ? { select: v.select } : {}),
              orderBy: v.orderBy,
              take: sampleSize,
            }),
          ])
          const columns = rows.length > 0 ? Object.keys(rows[0]) : []
          const serialised = rows.map((r: any) => {
            const out: any = {}
            for (const k of Object.keys(r)) {
              const val = r[k]
              if (val instanceof Date)       out[k] = val.toISOString()
              else if (typeof val === "bigint") out[k] = val.toString()
              else if (val && typeof val === "object") out[k] = JSON.stringify(val)
              else out[k] = val
            }
            return out
          })
          return { key, label: v.label, group: v.group, description: v.description, count, columns, samples: serialised }
        } catch (e: any) {
          return { key, label: v.label, group: v.group, description: v.description, count: null, error: e?.message, columns: [], samples: [] }
        }
      }))
      return NextResponse.json({ overview: results })
    }

    if (!tableKey) {
      // Return the catalogue of browsable tables (no samples, no counts)
      const items = (Object.entries(whitelist) as [ModelKey, WhitelistEntry][])
        .map(([key, v]) => ({ key, label: v.label, group: v.group, description: v.description }))
      return NextResponse.json({ tables: items })
    }

    const entry = whitelist[tableKey]
    if (!entry) return NextResponse.json({ error: "Unknown or non-browsable table" }, { status: 400 })

    // Build the WHERE clause from the search input. OR across each searchable
    // field with case-insensitive contains. Empty search returns everything.
    const where = search && entry.searchFields.length > 0
      ? { OR: entry.searchFields.map(f => ({ [f]: { contains: search, mode: "insensitive" as const } })) }
      : {}

    const [rows, total] = await Promise.all([
      entry.delegate.findMany({
        where,
        ...(entry.select ? { select: entry.select } : {}),
        orderBy: entry.orderBy,
        take: limit,
        skip: offset,
      }),
      entry.delegate.count({ where }),
    ])

    // Discover columns from the first row — converts Date/BigInt to friendly forms
    const columns = rows.length > 0 ? Object.keys(rows[0]) : []
    const serialised = rows.map((r: any) => {
      const out: any = {}
      for (const k of Object.keys(r)) {
        const v = r[k]
        if (v instanceof Date) out[k] = v.toISOString()
        else if (typeof v === "bigint") out[k] = v.toString()
        else if (v && typeof v === "object") out[k] = JSON.stringify(v)
        else out[k] = v
      }
      return out
    })

    return NextResponse.json({ table: tableKey, columns, rows: serialised, total, limit, offset })
  } catch (e: any) {
    console.error("databases/browse error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

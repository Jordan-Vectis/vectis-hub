import { prisma } from "@/lib/prisma"

// ─── Department-based sale access ────────────────────────────────────────────
//
// A department covers a set of CatalogueAuction.auctionType values, and people
// are linked to departments (many-to-many). A cataloguer sees the sales their
// departments cover, plus any single sale an admin has added them to.
//
// Two deliberate "see everything" cases, both so that turning this on cannot
// silently lock the whole team out:
//   1. The person is in no department at all — unassigned means unrestricted.
//   2. Their departments between them cover no auction types yet — i.e. the
//      departments exist but nobody has mapped the sale types across, so there
//      is nothing meaningful to filter by.
// Restriction only bites once a department genuinely covers a type.
//
// Every read here is wrapped: this feature's tables and the auctionTypes column
// only exist after Run Migrations, but code reaches Railway the moment it is
// pushed. A missing table must fall back to unrestricted, never to an error
// page or an empty sale list.

export type DepartmentAccess = {
  /** true = see every sale (admin, unassigned, or nothing mapped yet) */
  unrestricted: boolean
  /** auctionType values this person's departments cover */
  auctionTypes: string[]
  /** sales they've been individually added to, outside their departments */
  extraAuctionIds: string[]
}

const UNRESTRICTED: DepartmentAccess = { unrestricted: true, auctionTypes: [], extraAuctionIds: [] }

export async function getDepartmentAccess(userId: string, role: string): Promise<DepartmentAccess> {
  if (role === "ADMIN") return UNRESTRICTED
  try {
    const [links, extras] = await Promise.all([
      prisma.userDepartment.findMany({
        where:  { userId },
        select: { department: { select: { auctionTypes: true } } },
      }),
      prisma.catalogueAuctionAccess.findMany({
        where:  { userId },
        select: { auctionId: true },
      }),
    ])

    const auctionTypes = [...new Set(links.flatMap(l => l.department?.auctionTypes ?? []))]
    if (auctionTypes.length === 0) return UNRESTRICTED   // case 1 and 2 above

    return {
      unrestricted:    false,
      auctionTypes,
      extraAuctionIds: extras.map(e => e.auctionId),
    }
  } catch {
    return UNRESTRICTED   // not migrated yet — never lock anyone out
  }
}

/**
 * Prisma `where` fragment for CatalogueAuction, to spread into an existing
 * query: `where: { ...auctionWhere(access), complete: false }`.
 * Returns `{}` when unrestricted.
 */
export function auctionWhere(access: DepartmentAccess): Record<string, unknown> {
  if (access.unrestricted) return {}
  return {
    OR: [
      { auctionType: { in: access.auctionTypes } },
      ...(access.extraAuctionIds.length > 0 ? [{ id: { in: access.extraAuctionIds } }] : []),
    ],
  }
}

/** In-memory equivalent of `auctionWhere` — for a sale already loaded. */
export function canSeeAuction(
  access: DepartmentAccess,
  auction: { id: string; auctionType: string | null },
): boolean {
  if (access.unrestricted) return true
  if (auction.auctionType && access.auctionTypes.includes(auction.auctionType)) return true
  return access.extraAuctionIds.includes(auction.id)
}

/** Convenience: load the viewer's role from the DB and resolve their access. */
export async function getDepartmentAccessForSession(userId: string): Promise<DepartmentAccess> {
  const dbUser = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  return getDepartmentAccess(userId, dbUser?.role ?? "")
}

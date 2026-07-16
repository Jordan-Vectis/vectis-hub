import { prisma } from "@/lib/prisma"
import { headers } from "next/headers"

// Access Denial Log — see the AccessDenialLog model in prisma/schema.prisma for
// why this exists. Surfaced at /admin/access-log.
//
// The whole point is to capture what a permission gate ACTUALLY read at the
// moment it turned someone away, because the three failure shapes are
// indistinguishable after the fact:
//   • dbUserFound = false          → the read returned nothing
//   • dbAllowedApps missing an app → the row genuinely lacked it
//   • idMismatch = true            → the render read a DIFFERENT user's row
//
// Call this immediately BEFORE the redirect, never inside a try/catch that
// wraps the redirect — Next's redirect() works by throwing.

export interface DeniedSessionSnapshot {
  id: string
  email?: string | null
  name?: string | null
  role?: string | null
}

export interface DeniedDbSnapshot {
  id?: string | null
  email?: string | null
  role?: string | null
  allowedApps?: string[] | null
}

export async function logAccessDenied(opts: {
  appKey: string
  source: string
  session: DeniedSessionSnapshot
  dbUser: DeniedDbSnapshot | null
  note?: string
}): Promise<void> {
  try {
    let referer: string | null = null
    try {
      referer = (await headers()).get("referer")
    } catch {
      // headers() can be unavailable in some contexts — the referer is a nicety.
    }

    await prisma.accessDenialLog.create({
      data: {
        appKey:        opts.appKey,
        source:        opts.source,
        referer,
        sessionUserId: opts.session.id,
        sessionEmail:  opts.session.email ?? null,
        sessionName:   opts.session.name ?? null,
        sessionRole:   opts.session.role ?? null,
        dbUserFound:   !!opts.dbUser,
        dbUserId:      opts.dbUser?.id ?? null,
        dbEmail:       opts.dbUser?.email ?? null,
        dbRole:        opts.dbUser?.role ?? null,
        dbAllowedApps: opts.dbUser?.allowedApps ?? [],
        idMismatch:    !!opts.dbUser?.id && opts.dbUser.id !== opts.session.id,
        note:          opts.note ?? null,
      },
    })
  } catch {
    // A diagnostic must never break the page it is diagnosing — this also
    // covers the window after a deploy but before Run Migrations creates the
    // table, when the insert would fail on a missing relation.
  }
}

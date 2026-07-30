"use server"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"

// Same statement as the one in the run-migrations MIGRATIONS array. Kept here as
// a self-heal: code deploys to Railway instantly while migrations are applied by
// hand, so without this the Hide button silently does nothing in that window
// (which is exactly how it failed on staging, 2026-07-30). Idempotent, and the
// real migration still exists so fresh environments get the table properly.
const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS "ManagerPortalHiddenCategory" (
    "category"     TEXT NOT NULL,
    "hiddenById"   TEXT NOT NULL,
    "hiddenByName" TEXT NOT NULL,
    "hiddenAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "ManagerPortalHiddenCategory_pkey" PRIMARY KEY ("category")
  )`

function isMissingTable(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  const code = (e as { code?: string } | null)?.code
  return code === "P2021" || /does not exist|relation .* does not exist/i.test(msg)
}

// Admin-only. Hide or restore a BC article category in the Manager Portal →
// Departments "Using totes from — Business Central categories" table. For
// categories the cataloguing team doesn't work (or one-off junk categories like
// "DOLLS & BEARS" with a single tote) that would otherwise clutter the table.
// DISPLAY-ONLY: nothing about the category, its totes or its items changes, so
// it is restorable at any time. Toggles, same as the report exclusions.
export async function toggleHiddenBcCategory(
  category: string,
): Promise<{ ok: boolean; hidden?: boolean; error?: string }> {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") return { ok: false, error: "Admins only" }

    const key = category.trim()
    if (!key) return { ok: false, error: "Invalid category" }

    const run = async (): Promise<boolean> => {
      const existing = await prisma.managerPortalHiddenCategory.findUnique({ where: { category: key } })
      if (existing) {
        await prisma.managerPortalHiddenCategory.delete({ where: { category: key } })
        return false
      }
      await prisma.managerPortalHiddenCategory.create({
        data: {
          category:     key,
          hiddenById:   session.user.id,
          hiddenByName: session.user.name ?? session.user.email ?? "Admin",
        },
      })
      return true
    }

    let hidden: boolean
    try {
      hidden = await run()
    } catch (e: unknown) {
      if (!isMissingTable(e)) throw e
      await prisma.$executeRawUnsafe(CREATE_TABLE_SQL)
      hidden = await run()
    }

    revalidatePath("/tools/manager-portal", "layout")
    return { ok: true, hidden }
  } catch (e: unknown) {
    // ⚠ RETURN the error, never throw — a thrown server action is redacted in
    // production and the user would just see "An error occurred…".
    console.error("toggleHiddenBcCategory error:", e)
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" }
  }
}

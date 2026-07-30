"use server"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"

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

    const existing = await prisma.managerPortalHiddenCategory.findUnique({ where: { category: key } })

    let hidden: boolean
    if (existing) {
      await prisma.managerPortalHiddenCategory.delete({ where: { category: key } })
      hidden = false
    } else {
      await prisma.managerPortalHiddenCategory.create({
        data: {
          category:     key,
          hiddenById:   session.user.id,
          hiddenByName: session.user.name ?? session.user.email ?? "Admin",
        },
      })
      hidden = true
    }

    revalidatePath("/tools/manager-portal", "layout")
    return { ok: true, hidden }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" }
  }
}

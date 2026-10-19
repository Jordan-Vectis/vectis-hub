import { prisma } from "@/lib/prisma"
import { resolveLayout, type HomeLayout, type StoredLayout } from "@/lib/home-layout"

// The saved home page layout, or the built-in one if nothing is saved — or if the table isn't
// there yet (before Run Migrations), so the home page can never fail on it.
export async function getHomeLayout(): Promise<HomeLayout> {
  try {
    const row = await prisma.homePageLayout.findUnique({ where: { id: "global" } })
    return resolveLayout((row?.data as StoredLayout | undefined) ?? null)
  } catch (e: any) {
    console.warn("[home-layout] couldn't read the saved layout, using the built-in one:", e?.message)
    return resolveLayout(null)
  }
}

"use server"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"

// Admin-only. Hide or restore a single working day from ONE cataloguer's
// performance report. REPORT-ONLY — the underlying CatalogueTimingLog / IdleLog
// rows are never touched, so a day can be restored at any time. `day` is the
// London calendar-day key "YYYY-MM-DD" (matches ukDayKey() used across the
// reports). Toggles: if the day is already excluded it is restored, else hidden.
//
// Returns the error rather than throwing so the client can show it — server
// actions have their real message redacted in production builds.
export async function toggleReportExcludedDay(
  userId: string,
  day: string,
): Promise<{ ok: boolean; excluded?: boolean; error?: string }> {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") return { ok: false, error: "Admins only" }
    if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, error: "Invalid day" }

    const existing = await prisma.reportExcludedDay.findUnique({
      where: { userId_day: { userId, day } },
    })

    let excluded: boolean
    if (existing) {
      await prisma.reportExcludedDay.delete({ where: { userId_day: { userId, day } } })
      excluded = false
    } else {
      await prisma.reportExcludedDay.create({
        data: {
          userId,
          day,
          excludedById:   session.user.id,
          excludedByName: session.user.name ?? session.user.email ?? "Admin",
        },
      })
      excluded = true
    }

    // Both the individual report and the overview list/charts read these rows.
    revalidatePath("/tools/reports", "layout")
    return { ok: true, excluded }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" }
  }
}

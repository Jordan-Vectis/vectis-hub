import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { readAnnouncement } from "@/lib/announcements-db"
import { readAllPatchNotes } from "@/lib/patch-notes-db"
import AnnouncementsTabs from "./announcements-tabs"

export const dynamic = "force-dynamic"
export const metadata = { title: "Announcements" }

export default async function AnnouncementsPage() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/hub")

  const [a, notes] = await Promise.all([readAnnouncement(), readAllPatchNotes()])

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Announcements</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Two ways to tell staff something: a live banner for right now, or patch notes for what&apos;s changed.
        </p>
      </div>
      <AnnouncementsTabs
        banner={{
          message: a?.message ?? "",
          level:   a?.level ?? "warning",
          active:  a?.active ?? false,
          updatedAt:     a?.updatedAt ? a.updatedAt.toISOString() : null,
          updatedByName: a?.updatedByName ?? null,
        }}
        notes={notes.status === "ok" ? notes.notes.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })) : []}
        loadState={notes.status === "ok" ? null : notes}
      />
    </div>
  )
}

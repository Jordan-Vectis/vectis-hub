import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { readAnnouncement } from "@/lib/announcements-db"
import AnnouncementsManager from "./announcements-client"

export const dynamic = "force-dynamic"
export const metadata = { title: "Announcements" }

export default async function AnnouncementsPage() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/hub")

  const a = await readAnnouncement()

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Announcements</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Show a custom banner to everyone using the app — e.g. after an update, or to warn of planned downtime.
          Turn it on, type your message, and Save. It appears at the top of the app for all users within a minute.
          Turn it off (or clear the message) to remove it.
        </p>
      </div>
      <AnnouncementsManager
        initial={{
          message: a?.message ?? "",
          level:   a?.level ?? "warning",
          active:  a?.active ?? false,
          updatedAt:     a?.updatedAt ? a.updatedAt.toISOString() : null,
          updatedByName: a?.updatedByName ?? null,
        }}
      />
    </div>
  )
}

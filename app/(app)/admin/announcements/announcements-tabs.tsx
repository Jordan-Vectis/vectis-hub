"use client"

import { useState } from "react"
import AnnouncementsManager, { type Initial as BannerInitial } from "./announcements-client"
import PatchNotesManager, { type PatchNoteRow, type PatchNotesLoadState } from "./patch-notes-client"

const TABS = [
  { key: "banner", label: "📣 Banner", blurb: "One live message across the top of the app — for something happening now, like planned downtime. Everyone sees the same bar until you turn it off." },
  { key: "patch",  label: "✨ Patch notes", blurb: "A dated summary of fixes and changes, shown once as a popup. Write and save it as a draft, then press Push when you're ready to send it out." },
] as const

export default function AnnouncementsTabs({
  banner, notes, loadState,
}: {
  banner: BannerInitial
  notes: PatchNoteRow[]
  loadState: PatchNotesLoadState
}) {
  const [tab, setTab] = useState<"banner" | "patch">("banner")
  const active = TABS.find((t) => t.key === tab)!

  return (
    <div>
      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-800 mb-4">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">{active.blurb}</p>

      {tab === "banner"
        ? <AnnouncementsManager initial={banner} />
        : <PatchNotesManager notes={notes} loadState={loadState} />}
    </div>
  )
}

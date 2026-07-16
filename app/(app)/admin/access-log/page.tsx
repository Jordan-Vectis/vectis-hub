import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import Link from "next/link"
import ClearLogButton from "./clear-button"

const PAGE_SIZE = 200

// Access Log — the diagnostic surface for AccessDenialLog. Every row is one
// moment where an app gate turned a logged-in user away, recording what the
// session claimed AND what the database read actually returned. See
// lib/access-log.ts for why the distinction matters.

type Row = {
  id: string
  createdAt: Date
  appKey: string
  source: string
  referer: string | null
  sessionUserId: string
  sessionEmail: string | null
  sessionName: string | null
  sessionRole: string | null
  isImpersonating: boolean
  adminId: string | null
  adminName: string | null
  dbUserFound: boolean
  dbUserId: string | null
  dbEmail: string | null
  dbRole: string | null
  dbAllowedApps: string[]
  idMismatch: boolean
  note: string | null
}

const SOURCE_LABELS: Record<string, string> = {
  cataloguing_layout: "Cataloguing (all pages)",
}

// The whole reason this page exists: name which shape happened.
function verdict(r: Row): { label: string; detail: string; cls: string } {
  // Checked first: while impersonating, the "session" IS the target, so the
  // checks below would describe the wrong person entirely.
  if (r.isImpersonating) {
    return {
      label: "Was being impersonated",
      detail:
        `This session was ${r.adminName ?? "an admin"} impersonating them, so the gate judged the impersonated account, not the person sitting at the screen. Check whether an impersonation cookie was left behind on a shared machine.`,
      cls: "bg-purple-900/50 text-purple-300 border-purple-600",
    }
  }
  if (!r.dbUserFound) {
    return {
      label: "Read returned nothing",
      detail:
        "The permission lookup found no user row at all. The gate fails closed, so they were bounced. Points at a transient database read rather than their permissions.",
      cls: "bg-amber-900/40 text-amber-300 border-amber-700",
    }
  }
  if (r.idMismatch) {
    return {
      label: "Read a DIFFERENT user's row",
      detail:
        "The lookup returned a row belonging to someone else. This is the serious one — it would mean a render saw another person's permissions.",
      cls: "bg-red-900/50 text-red-300 border-red-600",
    }
  }
  return {
    label: `Row read fine but had no ${r.appKey}`,
    detail:
      "Their own row was read successfully and genuinely did not include this app at that moment. If their permissions look correct now, something wrote them and put them back.",
    cls: "bg-blue-900/40 text-blue-300 border-blue-700",
  }
}

function fmt(d: Date) {
  return new Date(d).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  })
}

export default async function AccessLogPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (session.user.role !== "ADMIN") redirect("/hub")

  // Migration-safe: the table does not exist until Run Migrations is clicked.
  let rows: Row[] = []
  let tableMissing = false
  try {
    rows = (await prisma.accessDenialLog.findMany({
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
    })) as Row[]
  } catch {
    tableMissing = true
  }

  const mismatches = rows.filter(r => r.idMismatch).length

  return (
    <div className="p-6 w-full">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-2">
        <div>
          <h1 className="text-2xl font-bold text-white">🚧 Access Log</h1>
          <p className="text-gray-400 text-sm mt-1 max-w-3xl">
            Every time the app turned a logged-in user away from a section they should have reached.
            Each row records what their session said <em>and</em> what the permission check actually
            read back, so an intermittent bounce can be diagnosed after the fact instead of guessed at.
          </p>
        </div>
        {rows.length > 0 && <ClearLogButton />}
      </div>

      {tableMissing ? (
        <div className="mt-6 bg-amber-950/40 border border-amber-700 rounded-xl p-5">
          <p className="text-amber-200 font-medium">The access log table does not exist yet.</p>
          <p className="text-amber-300/80 text-sm mt-1">
            Click <strong>Run Migrations</strong> in the admin banner to create it. Nothing is being
            recorded until then.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-6 bg-[#1C1C1E] border border-gray-700 rounded-xl p-8 text-center">
          <p className="text-gray-300 font-medium">Nothing logged yet.</p>
          <p className="text-gray-500 text-sm mt-1">
            That is the good outcome — it means nobody has been wrongly bounced since this was
            switched on. A row will appear here the next time it happens.
          </p>
        </div>
      ) : (
        <>
          {mismatches > 0 && (
            <div className="mt-4 bg-red-950/50 border border-red-600 rounded-xl p-4">
              <p className="text-red-200 font-semibold">
                {mismatches} {mismatches === 1 ? "entry shows" : "entries show"} a cross-user read.
              </p>
              <p className="text-red-300/80 text-sm mt-1">
                A permission lookup returned someone else&apos;s row. Worth acting on straight away.
              </p>
            </div>
          )}

          <div className="mt-4 overflow-x-auto border border-gray-700 rounded-xl">
            <table className="w-full text-sm">
              <thead className="bg-[#111]">
                <tr className="text-left text-gray-400">
                  <th className="p-3 font-medium whitespace-nowrap">When</th>
                  <th className="p-3 font-medium">What happened</th>
                  <th className="p-3 font-medium">Who (session)</th>
                  <th className="p-3 font-medium">What the database returned</th>
                  <th className="p-3 font-medium">Where</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const v = verdict(r)
                  return (
                    <tr key={r.id} className="border-t border-gray-800 align-top">
                      <td className="p-3 text-gray-400 whitespace-nowrap">{fmt(r.createdAt)}</td>
                      <td className="p-3 max-w-md">
                        <span className={`inline-block px-2 py-0.5 rounded border text-xs font-medium ${v.cls}`}>
                          {v.label}
                        </span>
                        <p className="text-gray-500 text-xs mt-1.5 leading-relaxed">{v.detail}</p>
                        {r.note && <p className="text-gray-400 text-xs mt-1">{r.note}</p>}
                      </td>
                      <td className="p-3 text-gray-300">
                        <div className="font-medium">{r.sessionName ?? "—"}</div>
                        <div className="text-gray-500 text-xs">{r.sessionEmail ?? "—"}</div>
                        <div className="text-gray-500 text-xs">Role: {r.sessionRole ?? "—"}</div>
                        {r.isImpersonating && (
                          <div className="mt-1 text-purple-300 text-xs">
                            Impersonated by {r.adminName ?? "an admin"}
                          </div>
                        )}
                        <div className="text-gray-600 text-[11px] font-mono mt-1">{r.sessionUserId}</div>
                      </td>
                      <td className="p-3 text-gray-300">
                        {!r.dbUserFound ? (
                          <span className="text-amber-400">No row returned</span>
                        ) : (
                          <>
                            <div className="text-gray-500 text-xs">{r.dbEmail ?? "—"}</div>
                            <div className="text-gray-500 text-xs">Role: {r.dbRole ?? "—"}</div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {r.dbAllowedApps.length === 0 ? (
                                <span className="text-xs text-amber-400">(no apps)</span>
                              ) : (
                                r.dbAllowedApps.map(a => (
                                  <span
                                    key={a}
                                    className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 text-[11px]"
                                  >
                                    {a}
                                  </span>
                                ))
                              )}
                            </div>
                            <div
                              className={`text-[11px] font-mono mt-1 ${
                                r.idMismatch ? "text-red-400" : "text-gray-600"
                              }`}
                            >
                              {r.dbUserId ?? "—"}
                            </div>
                          </>
                        )}
                      </td>
                      <td className="p-3 text-gray-400 text-xs">
                        <div>{SOURCE_LABELS[r.source] ?? r.source}</div>
                        <div className="text-gray-600 break-all mt-1">{r.referer ?? "—"}</div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-gray-600 text-xs mt-3">
            Showing the most recent {Math.min(rows.length, PAGE_SIZE)} entries.
          </p>
        </>
      )}

      <div className="mt-6">
        <Link href="/admin" className="text-blue-400 hover:text-blue-300 text-sm">
          ← Back to Admin
        </Link>
      </div>
    </div>
  )
}

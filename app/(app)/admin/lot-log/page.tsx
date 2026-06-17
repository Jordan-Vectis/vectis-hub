import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import Link from "next/link"

const PAGE_SIZE = 50

type SearchParams = { page?: string; auction?: string; barcode?: string; field?: string; user?: string }

export default async function LotLogPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/hub")

  const sp     = await searchParams
  const page   = Math.max(1, parseInt(sp.page ?? "1"))
  const skip   = (page - 1) * PAGE_SIZE
  const fAuction = sp.auction?.trim() ?? ""
  const fBarcode = sp.barcode?.trim() ?? ""
  const fField   = sp.field?.trim() ?? ""
  const fUser    = sp.user?.trim() ?? ""

  const where = {
    ...(fAuction ? { auctionCode: { contains: fAuction, mode: "insensitive" as const } } : {}),
    ...(fBarcode ? { lotBarcode:  { contains: fBarcode,  mode: "insensitive" as const } } : {}),
    ...(fField   ? { field:       { contains: fField,    mode: "insensitive" as const } } : {}),
    ...(fUser    ? { changedBy:   { contains: fUser,     mode: "insensitive" as const } } : {}),
  }

  const [events, total, allFields, allUsers] = await Promise.all([
    prisma.catalogueLotEvent.findMany({ where, orderBy: { changedAt: "desc" }, skip, take: PAGE_SIZE }),
    prisma.catalogueLotEvent.count({ where }),
    prisma.catalogueLotEvent.findMany({ distinct: ["field"],     select: { field: true },     orderBy: { field: "asc" } }),
    prisma.catalogueLotEvent.findMany({ distinct: ["changedBy"], select: { changedBy: true }, orderBy: { changedBy: "asc" } }),
  ])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function buildUrl(overrides: Partial<SearchParams>) {
    const params = new URLSearchParams()
    const merged = { page: String(page), auction: fAuction, barcode: fBarcode, field: fField, user: fUser, ...overrides }
    Object.entries(merged).forEach(([k, v]) => { if (v) params.set(k, v) })
    return `/admin/lot-log?${params.toString()}`
  }

  const input = "rounded-lg border border-gray-700 bg-[#1C1C1E] px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6] w-full"
  const sel   = "rounded-lg border border-gray-700 bg-[#1C1C1E] px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6]"

  return (
    <div className="p-6 max-w-screen-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin" className="text-sm text-[#2AB4A6] hover:text-[#24a090]">← Admin</Link>
        <span className="text-gray-600">/</span>
        <h1 className="text-xl font-bold text-white">Lot Change Log</h1>
        <span className="text-xs text-gray-500 ml-2">{total.toLocaleString()} event{total !== 1 ? "s" : ""}</span>
      </div>

      {/* Filters */}
      <form method="get" action="/admin/lot-log" className="flex flex-wrap gap-3 mb-5">
        <input name="auction" defaultValue={fAuction} placeholder="Auction code…" className={input} style={{ width: 160 }} />
        <input name="barcode" defaultValue={fBarcode} placeholder="Barcode…"      className={input} style={{ width: 140 }} />
        <select name="field" defaultValue={fField} className={sel}>
          <option value="">All fields</option>
          {allFields.map(f => <option key={f.field} value={f.field}>{f.field}</option>)}
        </select>
        <select name="user" defaultValue={fUser} className={sel}>
          <option value="">All users</option>
          {allUsers.map(u => <option key={u.changedBy} value={u.changedBy}>{u.changedBy}</option>)}
        </select>
        <button type="submit" className="px-4 py-1.5 rounded-lg bg-[#2AB4A6] text-white text-sm font-medium hover:bg-[#24a090] transition-colors">Filter</button>
        {(fAuction || fBarcode || fField || fUser) && (
          <Link href="/admin/lot-log" className="px-4 py-1.5 rounded-lg border border-gray-700 text-gray-400 text-sm hover:text-gray-200 transition-colors">Clear</Link>
        )}
      </form>

      {/* Table */}
      {events.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          {total === 0 ? "No changes recorded yet — the log fills as lots are edited." : "No events match your filters."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-[#1C1C1E]">
                <th className="text-left px-4 py-2.5 text-gray-400 font-medium whitespace-nowrap">Date / Time</th>
                <th className="text-left px-4 py-2.5 text-gray-400 font-medium">Auction</th>
                <th className="text-left px-4 py-2.5 text-gray-400 font-medium">Lot</th>
                <th className="text-left px-4 py-2.5 text-gray-400 font-medium">Field</th>
                <th className="text-left px-4 py-2.5 text-gray-400 font-medium">Old value</th>
                <th className="text-left px-4 py-2.5 text-gray-400 font-medium">New value</th>
                <th className="text-left px-4 py-2.5 text-gray-400 font-medium whitespace-nowrap">Changed by</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => {
                const isEstimate = e.field === "Estimate Low" || e.field === "Estimate High"
                const wasCleared = e.newValue == null || e.newValue === ""
                const rowBg = isEstimate && wasCleared
                  ? "bg-red-950/20"
                  : i % 2 === 0 ? "bg-[#141416]" : "bg-[#1C1C1E]"
                return (
                  <tr key={e.id} className={`border-b border-gray-800 last:border-0 ${rowBg}`}>
                    <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap font-mono text-xs">
                      {e.changedAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                      {" "}
                      <span className="text-gray-600">{e.changedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[#2AB4A6] text-xs">{e.auctionCode}</td>
                    <td className="px-4 py-2.5 max-w-[200px]">
                      <span className="font-mono text-xs text-gray-300">{e.lotBarcode ?? "—"}</span>
                      {e.lotTitle && <span className="block text-xs text-gray-600 truncate">{e.lotTitle}</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${isEstimate ? "bg-amber-900/30 text-amber-300" : "bg-gray-800 text-gray-300"}`}>
                        {e.field}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 max-w-[280px]">
                      {e.oldValue
                        ? e.oldValue.length > 120
                          ? <details className="text-xs"><summary className="text-gray-400 line-through cursor-pointer select-none">{e.oldValue.slice(0, 120)}…</summary><span className="text-gray-400 line-through break-words whitespace-pre-wrap">{e.oldValue}</span></details>
                          : <span className="text-gray-400 text-xs line-through break-words whitespace-pre-wrap">{e.oldValue}</span>
                        : <span className="text-gray-700 text-xs italic">empty</span>}
                    </td>
                    <td className="px-4 py-2.5 max-w-[280px]">
                      {e.newValue
                        ? e.newValue.length > 120
                          ? <details className="text-xs"><summary className="text-gray-200 cursor-pointer select-none">{e.newValue.slice(0, 120)}…</summary><span className="text-gray-200 break-words whitespace-pre-wrap">{e.newValue}</span></details>
                          : <span className="text-gray-200 text-xs break-words whitespace-pre-wrap">{e.newValue}</span>
                        : <span className="text-red-400 text-xs italic">cleared</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-400 text-xs whitespace-nowrap">{e.changedBy}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center gap-2 mt-4 text-sm">
          {page > 1 && (
            <Link href={buildUrl({ page: String(page - 1) })} className="px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors">← Prev</Link>
          )}
          <span className="text-gray-500">Page {page} of {totalPages}</span>
          {page < totalPages && (
            <Link href={buildUrl({ page: String(page + 1) })} className="px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors">Next →</Link>
          )}
        </div>
      )}
    </div>
  )
}

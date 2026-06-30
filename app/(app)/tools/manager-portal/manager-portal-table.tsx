"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { AUCTION_TYPES, auctionTypeEmoji, auctionTypeLabel } from "@/lib/auction-types"

export type SaleRow = {
  id: string
  code: string
  name: string
  auctionDate: string | null
  auctionType: string
  hubLots: number
  complete: boolean
  addedToBC: boolean
  daily: number[]                 // chronological per-active-day lot counts
  avgDurationMs: number | null
  timedLots: number
  topCataloguers: { name: string; count: number }[]
}

type SaleBc = { bc: number; overlap: number; combined: number }
type BcState =
  | { status: "loading" }
  | { status: "disconnected" }
  | { status: "error"; message: string }
  | { status: "ready"; sales: Record<string, SaleBc | null> }

const DAY = 86_400_000
const AV_COLORS = ["#3E7BFA", "#2AB4A6", "#C77DFF", "#E0A458", "#4FB477"]

// ─── Formatting ──────────────────────────────────────────────────────────────

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
const fmtFullDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })

function fmtDuration(ms: number | null): string {
  if (ms == null || ms <= 0) return "—"
  const s = Math.round(ms / 1000)
  const m = Math.floor(s / 60)
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime() }
const fmtPace = (p: number) => (p >= 10 ? Math.round(p).toString() : p.toFixed(1))

function initials(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean)
  const ini = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")
  return ini.toUpperCase() || "?"
}

function daysToSale(auctionDate: string | null, nowMs: number): number | null {
  if (!auctionDate) return null
  return Math.ceil((Date.parse(auctionDate) - nowMs) / DAY)
}

type Milestone = { target: number; days: number; date: number; fill: number; late: boolean }

// `current` is the sale's combined (deduped) total — milestones project off the
// number the manager actually watches, so a 627-lot sale reads 700/800/900, not
// 500/600. Projected at the (Hub) cataloguing pace.
function milestonesFor(current: number, pace: number, nowMs: number, saleTs: number, count = 3): Milestone[] {
  if (pace <= 0) return []
  const out: Milestone[] = []
  let m = Math.floor(current / 100) * 100 + 100
  for (let i = 0; i < count; i++) {
    const days = Math.ceil((m - current) / pace)
    const date = nowMs + days * DAY
    out.push({ target: m, days, date, fill: clamp((current - (m - 100)) / 100, 0, 1) * 100, late: startOfDay(date) > startOfDay(saleTs) })
    m += 100
  }
  return out
}

function bcFor(code: string, bc: BcState): { loading: boolean; data: SaleBc | null } {
  if (bc.status === "loading") return { loading: true, data: null }
  if (bc.status !== "ready")   return { loading: false, data: null }
  return { loading: false, data: bc.sales[code] ?? null }
}

// ─── Scoped styles (mp- prefix → no global clash) ────────────────────────────

const STYLES = `
.mp-root{
  --panel:#1C1C1E; --inset:#161618; --line:#2C2C2E; --line-soft:rgba(255,255,255,.08);
  --teal:#2AB4A6; --teal-dim:rgba(42,180,166,.16); --teal-line:rgba(42,180,166,.34);
  --white:#FFFFFF; --body:#E5E7EB; --muted:#9CA3AF; --faint:#6B7280;
  --amber:#E0A458; --amber-dim:rgba(224,164,88,.14); --green:#4FB477; --bc:#7C83FF;
  display:flex; flex-direction:column; gap:14px; color:var(--body); line-height:1.4;
}
.mp-root *{box-sizing:border-box;}
.mp-card{background:var(--panel); border:1px solid var(--line); border-radius:14px; overflow:hidden;}
.mp-top{display:grid; grid-template-columns:250px 1fr 236px; align-items:stretch;}
.mp-ident{padding:18px; border-right:1px solid var(--line-soft); display:flex; flex-direction:column; gap:10px; min-width:0;}
.mp-ihead{display:flex; align-items:center; gap:9px; flex-wrap:wrap;}
.mp-code{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace; font-size:14px; font-weight:600; letter-spacing:.4px; color:var(--teal); background:var(--teal-dim); border:1px solid var(--teal-line); padding:3px 9px; border-radius:7px; text-decoration:none;}
.mp-code:hover{background:var(--teal-line);}
.mp-type{display:inline-flex; align-items:center; gap:5px; font-size:11.5px; color:var(--muted); background:var(--inset); border:1px solid var(--line-soft); padding:3px 9px; border-radius:7px; white-space:nowrap;}
.mp-name{font-size:17px; font-weight:650; color:var(--white); letter-spacing:-.2px; line-height:1.25;}
.mp-meta{display:flex; align-items:center; gap:7px; font-size:12.5px; color:var(--muted);}
.mp-meta b{color:var(--body); font-weight:550;}
.mp-urg{display:inline-flex; align-items:center; gap:7px; margin-top:2px; font-size:12px; font-weight:600; padding:6px 11px; border-radius:8px; align-self:flex-start;}
.mp-urg .d{width:7px; height:7px; border-radius:50%;}
.mp-cool{color:var(--muted); background:var(--inset); border:1px solid var(--line-soft);} .mp-cool .d{background:var(--faint);}
.mp-warm{color:var(--amber); background:var(--amber-dim); border:1px solid rgba(224,164,88,.28);} .mp-warm .d{background:var(--amber);}
.mp-hot{color:#F0A0A0; background:rgba(224,100,100,.12); border:1px solid rgba(224,100,100,.26);} .mp-hot .d{background:#E06464;}
.mp-metrics{padding:18px 20px; display:flex; flex-direction:column; gap:14px; min-width:0; justify-content:center;}
.mp-counts{display:flex; align-items:flex-end;}
.mp-count{display:flex; flex-direction:column; gap:3px; padding-right:20px;}
.mp-count + .mp-count{padding-left:20px; border-left:1px solid var(--line-soft);}
.mp-clabel{font-size:10.5px; letter-spacing:.7px; text-transform:uppercase; color:var(--faint); display:flex; align-items:center; gap:6px;}
.mp-clabel .sw{width:8px; height:8px; border-radius:2px;}
.mp-cval{font-size:26px; font-weight:680; color:var(--body); letter-spacing:-.6px; line-height:1;}
.mp-hero .mp-cval{font-size:38px; color:var(--white); letter-spacing:-1.2px;}
.mp-hero .mp-clabel{color:var(--teal);}
.mp-csub{font-size:10.5px; color:var(--faint);}
.mp-segw{display:flex; flex-direction:column; gap:7px;}
.mp-seg{display:flex; height:9px; border-radius:5px; overflow:hidden; background:var(--inset); border:1px solid var(--line-soft);}
.mp-seg i{height:100%;}
.mp-segleg{display:flex; align-items:center; gap:16px; font-size:11px; color:var(--muted); flex-wrap:wrap;}
.mp-segleg span{display:inline-flex; align-items:center; gap:6px;}
.mp-segleg em{width:9px; height:9px; border-radius:2px; display:inline-block; font-style:normal;}
.mp-segleg b{color:var(--body); font-weight:600;}
.mp-overlap{margin-left:auto; color:var(--faint); font-size:11px;}
.mp-overlap b{color:var(--muted); font-weight:600;}
.mp-rail{padding:18px; border-left:1px solid var(--line-soft); display:flex; flex-direction:column; gap:11px; background:linear-gradient(180deg,rgba(255,255,255,.012),transparent); justify-content:center;}
.mp-rhead{font-size:10.5px; letter-spacing:.7px; text-transform:uppercase; color:var(--faint);}
.mp-pbig{display:flex; align-items:baseline; gap:7px;}
.mp-pnum{font-size:30px; font-weight:680; color:var(--white); letter-spacing:-1px; line-height:1;}
.mp-punit{font-size:13px; color:var(--muted); font-weight:550;}
.mp-psub{font-size:11.5px; color:var(--faint);}
.mp-spark{display:flex; align-items:flex-end; gap:3px; height:30px; margin-top:2px;}
.mp-spark i{flex:1; background:var(--teal); border-radius:2px 2px 0 0; opacity:.85; min-height:3px;}
.mp-spark i.cur{background:var(--white); opacity:1;}
.mp-expand{border-top:1px solid var(--line-soft); background:var(--inset);}
.mp-ebar{display:flex; align-items:center; gap:9px; padding:9px 18px; font-size:11.5px; color:var(--muted);}
.mp-ebar.click{cursor:pointer;} .mp-ebar.click:hover{color:var(--body);}
.mp-ebar .chev{transition:transform .2s; color:var(--faint);}
.mp-ebar.open .chev{transform:rotate(90deg);}
.mp-ebar b{color:var(--body); font-weight:600;}
.mp-ebody{padding:4px 18px 18px; display:grid; grid-template-columns:1fr 1fr; gap:18px;}
.mp-ebody.one{grid-template-columns:1fr;}
.mp-pi{background:var(--panel); border:1px solid var(--line-soft); border-radius:11px; padding:14px 15px;}
.mp-pititle{font-size:10.5px; letter-spacing:.7px; text-transform:uppercase; color:var(--faint); margin-bottom:12px;}
.mp-tiles{display:flex; gap:10px;}
.mp-tile{flex:1; background:var(--inset); border:1px solid var(--line-soft); border-radius:9px; padding:11px 12px; display:flex; flex-direction:column; gap:5px;}
.mp-tval{font-size:18px; font-weight:660; color:var(--white); letter-spacing:-.4px; line-height:1;}
.mp-tval small{font-size:12px; color:var(--muted); font-weight:550;}
.mp-tlabel{font-size:10.5px; color:var(--muted);}
.mp-ladder{display:flex; flex-direction:column; gap:9px;}
.mp-rung{display:flex; align-items:center; gap:11px; font-size:12.5px;}
.mp-rung .ms{width:42px; font-weight:650; color:var(--body);}
.mp-rung .tk{flex:1; height:6px; border-radius:4px; background:var(--inset); border:1px solid var(--line-soft); overflow:hidden;}
.mp-rung .fl{height:100%; background:var(--teal); border-radius:4px;}
.mp-rung .wh{width:74px; text-align:right; color:var(--muted); font-size:11.5px;}
.mp-rung .wh.late{color:var(--amber);}
.mp-cats{display:flex; flex-direction:column; gap:11px;}
.mp-cat{display:flex; align-items:center; gap:11px;}
.mp-cav{width:28px; height:28px; border-radius:50%; flex:none; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:650; color:#fff;}
.mp-cmid{flex:1; min-width:0;}
.mp-cname{font-size:12.5px; color:var(--body); font-weight:550; display:flex; justify-content:space-between; margin-bottom:5px;}
.mp-cname span{color:var(--muted); font-weight:500;}
.mp-cbar{height:5px; border-radius:3px; background:var(--inset); overflow:hidden;}
.mp-cbar i{display:block; height:100%; border-radius:3px;}
.mp-foot{font-size:11px; color:var(--faint); padding:2px;}
@media (max-width:880px){
  .mp-top{grid-template-columns:1fr;}
  .mp-ident{border-right:none; border-bottom:1px solid var(--line-soft);}
  .mp-rail{border-left:none; border-top:1px solid var(--line-soft);}
  .mp-ebody{grid-template-columns:1fr;}
}
`

// ─── Active sale card ────────────────────────────────────────────────────────

function ActiveSaleCard({ row, bc, nowMs, open, onToggle }: {
  row: SaleRow; bc: BcState; nowMs: number; open: boolean; onToggle: () => void
}) {
  const { loading, data } = bcFor(row.code, bc)
  const bcTxt    = loading ? "…" : data ? data.bc.toLocaleString() : "—"
  const combined = data ? data.combined : row.hubLots
  const totalTxt = loading ? "…" : combined.toLocaleString()
  const bcOnly   = data ? Math.max(0, data.combined - row.hubLots) : 0
  const hubPct   = combined > 0 ? (row.hubLots / combined) * 100 : 100
  const overlap  = data?.overlap

  const dts = daysToSale(row.auctionDate, nowMs)
  const saleTs = row.auctionDate ? Date.parse(row.auctionDate) : Infinity

  const activeDays = row.daily.length
  const pace = activeDays >= 2 ? row.hubLots / activeDays : 0
  const hasPace = pace > 0
  const hasTiming = row.avgDurationMs != null && row.timedLots > 0
  const hasCats = row.topCataloguers.length > 0
  const canExpand = hasPace || hasTiming || hasCats

  const spark = row.daily.slice(-14)
  const sparkMax = Math.max(...spark, 1)
  const ladder = milestonesFor(combined, pace, nowMs, saleTs)
  const topCount = Math.max(...row.topCataloguers.map(c => c.count), 1)

  const urg = dts == null ? "mp-cool"
    : dts < 0 ? "mp-cool"
    : dts <= 7 ? "mp-hot"
    : dts <= 30 ? "mp-warm" : "mp-cool"
  const urgText = dts == null ? "No sale date"
    : dts < 0 ? "Sale passed" : dts === 0 ? "Sale today" : `${dts} days to sale`

  return (
    <div className="mp-card">
      <div className="mp-top">
        {/* identity */}
        <div className="mp-ident">
          <div className="mp-ihead">
            <Link href={`/tools/cataloguing/auctions/${row.id}`} className="mp-code">{row.code}</Link>
            <span className="mp-type">{auctionTypeEmoji(row.auctionType)} {auctionTypeLabel(row.auctionType)}</span>
          </div>
          <div className="mp-name">{row.name}</div>
          <div className="mp-meta">Sale date <b>{row.auctionDate ? fmtFullDate(row.auctionDate) : "—"}</b></div>
          <span className={`mp-urg ${urg}`}><span className="d" />{urgText}</span>
        </div>

        {/* metrics */}
        <div className="mp-metrics">
          <div className="mp-counts">
            <div className="mp-count">
              <div className="mp-clabel"><span className="sw" style={{ background: "var(--teal)" }} />Hub</div>
              <div className="mp-cval">{row.hubLots.toLocaleString()}</div>
              <div className="mp-csub">catalogued in Hub</div>
            </div>
            <div className="mp-count">
              <div className="mp-clabel"><span className="sw" style={{ background: "var(--bc)" }} />BC</div>
              <div className="mp-cval">{bcTxt}</div>
              <div className="mp-csub">in Business Central</div>
            </div>
            <div className="mp-count mp-hero">
              <div className="mp-clabel">Total · deduped</div>
              <div className="mp-cval">{totalTxt}</div>
              <div className="mp-csub">combined lots</div>
            </div>
          </div>

          <div className="mp-segw">
            <div className="mp-seg">
              <i style={{ width: `${hubPct}%`, background: "var(--teal)" }} />
              <i style={{ width: `${100 - hubPct}%`, background: "var(--bc)" }} />
            </div>
            <div className="mp-segleg">
              <span><em style={{ background: "var(--teal)" }} />Hub <b>{row.hubLots.toLocaleString()}</b></span>
              <span><em style={{ background: "var(--bc)" }} />BC-only <b>{loading ? "…" : bcOnly.toLocaleString()}</b></span>
              {overlap != null && <span className="mp-overlap"><b>{overlap.toLocaleString()}</b> of {row.hubLots.toLocaleString()} Hub lots already in BC</span>}
            </div>
          </div>
        </div>

        {/* pace rail */}
        <div className="mp-rail">
          <div className="mp-rhead">Cataloguing pace</div>
          {hasPace ? (
            <>
              <div className="mp-pbig"><span className="mp-pnum">{fmtPace(pace)}</span><span className="mp-punit">lots / day</span></div>
              <div className="mp-psub">over {activeDays} active days</div>
              <div className="mp-spark">
                {spark.map((n, i) => (
                  <i key={i} className={i === spark.length - 1 ? "cur" : ""} style={{ height: `${Math.max(8, (n / sparkMax) * 100)}%` }} />
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="mp-pbig"><span className="mp-pnum" style={{ color: "var(--faint)" }}>—</span><span className="mp-punit">lots / day</span></div>
              <div className="mp-psub">{row.hubLots === 0 ? "No lots yet" : "Not enough days of activity"}</div>
            </>
          )}
        </div>
      </div>

      {/* expand */}
      <div className="mp-expand">
        {canExpand ? (
          <div className={`mp-ebar click ${open ? "open" : ""}`} onClick={onToggle}>
            <span className="chev">▸</span><b>Detail</b> — timing, projections &amp; cataloguers
          </div>
        ) : (
          <div className="mp-ebar"><span className="chev" style={{ opacity: 0.4 }}>▸</span>No timing or cataloguer data yet</div>
        )}

        {open && canExpand && (
          <div className={`mp-ebody ${hasCats ? "" : "one"}`}>
            {/* throughput + projections */}
            <div className="mp-pi">
              <div className="mp-pititle">Throughput</div>
              <div className="mp-tiles">
                <div className="mp-tile"><div className="mp-tval">{fmtDuration(row.avgDurationMs)}</div><div className="mp-tlabel">avg / lot</div></div>
                <div className="mp-tile"><div className="mp-tval">{hasPace ? fmtPace(pace) : "—"}<small>{hasPace ? " /day" : ""}</small></div><div className="mp-tlabel">current pace</div></div>
                <div className="mp-tile"><div className="mp-tval">{dts == null ? "—" : dts < 0 ? `${Math.abs(dts)}` : `${dts}`}</div><div className="mp-tlabel">{dts != null && dts < 0 ? "days ago" : "days to sale"}</div></div>
              </div>

              {hasPace && ladder.length > 0 && (
                <>
                  <div className="mp-pititle" style={{ marginTop: 18 }}>Projected milestones</div>
                  <div className="mp-ladder">
                    {ladder.map(m => (
                      <div key={m.target} className="mp-rung">
                        <span className="ms">{m.target.toLocaleString()}</span>
                        <span className="tk"><span className="fl" style={{ width: `${m.fill}%` }} /></span>
                        <span className={`wh ${m.late ? "late" : ""}`}>{fmtDate(m.date)}{m.late && " ⚠"}</span>
                      </div>
                    ))}
                  </div>
                  {row.auctionDate && (
                    <div className="mp-foot" style={{ marginTop: 8 }}>
                      {ladder.every(m => !m.late)
                        ? `All shown milestones land before the ${fmtDate(saleTs)} sale date.`
                        : `Some milestones fall after the ${fmtDate(saleTs)} sale date.`}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* cataloguers */}
            {hasCats && (
              <div className="mp-pi">
                <div className="mp-pititle">Top cataloguers</div>
                <div className="mp-cats">
                  {row.topCataloguers.map((c, i) => (
                    <div key={c.name} className="mp-cat">
                      <div className="mp-cav" style={{ background: AV_COLORS[i % AV_COLORS.length] }}>{initials(c.name)}</div>
                      <div className="mp-cmid">
                        <div className="mp-cname">{c.name || "Unknown"} <span>{c.count.toLocaleString()} lots</span></div>
                        <div className="mp-cbar"><i style={{ width: `${(c.count / topCount) * 100}%`, background: AV_COLORS[i % AV_COLORS.length] }} /></div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mp-foot" style={{ marginTop: 14 }}>{row.hubLots.toLocaleString()} Hub lots{activeDays >= 1 ? ` · ${activeDays} active day${activeDays === 1 ? "" : "s"}` : ""}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Completed sales (compact, ticks not counts) ─────────────────────────────

function CompletedTable({ rows }: { rows: SaleRow[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-200 dark:border-gray-800">
          {["Code", "Name", "Date", "Type"].map(h => <th key={h} className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">{h}</th>)}
          <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Added to BC</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.id} className="border-b border-gray-200 dark:border-gray-800 last:border-0">
            <td className="px-4 py-2.5">
              <Link href={`/tools/cataloguing/auctions/${row.id}`} className="font-mono font-semibold text-[#2AB4A6] hover:text-[#24a090]">{row.code}</Link>
            </td>
            <td className="px-4 py-2.5 text-gray-800 dark:text-gray-100">{row.name}</td>
            <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">{row.auctionDate ? fmtFullDate(row.auctionDate) : "—"}</td>
            <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 whitespace-nowrap"><span className="mr-1" title={auctionTypeLabel(row.auctionType)}>{auctionTypeEmoji(row.auctionType)}</span>{row.auctionType}</td>
            <td className="px-4 py-2.5">{row.addedToBC ? <span className="text-green-600 dark:text-green-400 font-semibold">✓ Added</span> : <span className="text-gray-400 dark:text-gray-600">—</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function matches(row: SaleRow, search: string, type: string): boolean {
  if (search) {
    const q = search.toLowerCase()
    if (!row.code.toLowerCase().includes(q) && !row.name.toLowerCase().includes(q)) return false
  }
  if (type !== "ALL" && row.auctionType !== type) return false
  return true
}

export default function ManagerPortalTable({ rows, nowMs }: { rows: SaleRow[]; nowMs: number }) {
  const [bc, setBc] = useState<BcState>({ status: "loading" })
  const [search, setSearch] = useState("")
  const [type, setType] = useState("ALL")
  const [open, setOpen] = useState<Set<string>>(new Set())

  const toggle = (id: string) => setOpen(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/manager-portal/bc-counts")
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) { setBc({ status: "error", message: data?.error ?? "BC query failed" }); return }
        if (!data.connected) { setBc({ status: "disconnected" }); return }
        setBc({ status: "ready", sales: data.sales ?? {} })
      } catch (e: any) {
        if (!cancelled) setBc({ status: "error", message: e?.message ?? "BC query failed" })
      }
    })()
    return () => { cancelled = true }
  }, [])

  const active    = useMemo(() => rows.filter(r => !r.complete), [rows])
  const completed = useMemo(() => rows.filter(r => r.complete), [rows])
  const filteredActive    = useMemo(() => active.filter(r => matches(r, search, type)),    [active, search, type])
  const filteredCompleted = useMemo(() => completed.filter(r => matches(r, search, type)), [completed, search, type])
  const hasFilter = !!search || type !== "ALL"

  const selectCls = "rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1C1C1E] px-3 py-2 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6]"

  return (
    <>
      <style>{STYLES}</style>

      {bc.status === "disconnected" && (
        <div className="mb-4 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-300">
          Business Central isn&apos;t connected for your account, so only Hub counts are shown. Connect BC (Tools → BC Warehouse) to see live BC lot counts.
        </div>
      )}
      {bc.status === "error" && (
        <div className="mb-4 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-2.5 text-sm text-red-700 dark:text-red-300">
          Couldn&apos;t load Business Central counts: {bc.message}. Hub counts are still shown below.
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search code or name…" className={`${selectCls} flex-1 min-w-[200px]`} />
        <select value={type} onChange={e => setType(e.target.value)} className={selectCls}>
          <option value="ALL">All types</option>
          {AUCTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.emoji} {t.label}</option>)}
        </select>
        {hasFilter && (
          <button onClick={() => { setSearch(""); setType("ALL") }} className="text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#2C2C2E] transition-colors">Clear</button>
        )}
      </div>

      {/* Active sales — cards */}
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Active Sales{hasFilter && ` (${filteredActive.length})`}</h2>
      {filteredActive.length === 0 ? (
        <div className="text-center py-10 text-gray-600 dark:text-gray-500 text-sm bg-white dark:bg-[#1C1C1E] rounded-xl border border-gray-300 dark:border-gray-700 mb-8">
          {hasFilter ? "No active sales match your filters." : "No active sales."}
        </div>
      ) : (
        <div className="mp-root mb-8">
          {filteredActive.map(row => (
            <ActiveSaleCard key={row.id} row={row} bc={bc} nowMs={nowMs} open={open.has(row.id)} onToggle={() => toggle(row.id)} />
          ))}
        </div>
      )}

      {/* Completed sales — compact */}
      {completed.length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-500 mb-2">Completed Sales{hasFilter && ` (${filteredCompleted.length})`}</h2>
          <div className="bg-white dark:bg-[#1C1C1E] rounded-xl border border-gray-300 dark:border-gray-700 overflow-x-auto opacity-80">
            {filteredCompleted.length === 0 ? (
              <div className="text-center py-10 text-gray-600 dark:text-gray-500 text-sm">No completed sales match your filters.</div>
            ) : (
              <CompletedTable rows={filteredCompleted} />
            )}
          </div>
        </>
      )}
    </>
  )
}

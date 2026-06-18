"use client"

import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, LabelList,
} from "recharts"
import type { MarketingReport } from "@/lib/ga"

const TOOLTIP = { background: "#2C2C2E", border: "1px solid #374151", borderRadius: 8, color: "#f3f4f6", fontSize: 13 }
const PIE_COLOURS = ["#ec4899", "#2AB4A6", "#6366f1", "#f59e0b", "#22c55e", "#06b6d4", "#a855f7"]
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const fmtNum = (n: number) => Math.round(n).toLocaleString("en-GB")
function fmtDate(d: string) {
  if (!/^\d{8}$/.test(d)) return d
  return `${Number(d.slice(6, 8))} ${MONTHS[Number(d.slice(4, 6)) - 1]}`
}
const trunc = (s: string, n = 30) => (s.length > n ? s.slice(0, n - 1) + "…" : s)

function downloadCsv(rows: { name: string; value: number; secondary?: number }[], filename: string) {
  const header = "Name,Value,Secondary\n"
  const body = rows.map((r) => `"${String(r.name).replace(/"/g, '""')}",${r.value},${r.secondary ?? ""}`).join("\n")
  const blob = new Blob([header + body], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function Card({ title, children, csv }: { title: string; children: React.ReactNode; csv?: { rows: { name: string; value: number; secondary?: number }[]; filename: string } }) {
  return (
    <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-2xl p-5">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h2 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{title}</h2>
        {csv && csv.rows.length > 0 && (
          <button
            onClick={() => downloadCsv(csv.rows, csv.filename)}
            className="text-xs font-semibold text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors flex-shrink-0"
            title="Download as CSV"
          >
            ⬇ CSV
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

function HBars({ data, colour, suffix }: { data: { name: string; value: number }[]; colour: string; suffix?: string }) {
  if (!data.length) return <p className="text-sm text-gray-400 py-6 text-center">No data.</p>
  const rows = data.map((d) => ({ name: trunc(d.name), value: d.value }))
  const h = Math.max(rows.length * 40 + 20, 120)
  return (
    <div style={{ height: h }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 64, left: 8, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={150} tick={{ fill: "#9ca3af", fontSize: 12 }} axisLine={false} tickLine={false} />
          <Tooltip formatter={(v) => [fmtNum(v as number) + (suffix ? ` ${suffix}` : ""), ""]} contentStyle={TOOLTIP} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          <Bar dataKey="value" fill={colour} radius={[0, 4, 4, 0]} maxBarSize={26}>
            <LabelList dataKey="value" position="right" formatter={(v: any) => fmtNum(Number(v ?? 0))} fill="#9ca3af" fontSize={12} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function Donut({ data }: { data: { name: string; value: number }[] }) {
  if (!data.length) return <p className="text-sm text-gray-400 py-6 text-center">No data.</p>
  return (
    <div style={{ height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
            {data.map((_, i) => <Cell key={i} fill={PIE_COLOURS[i % PIE_COLOURS.length]} />)}
          </Pie>
          <Tooltip formatter={(v, n) => [fmtNum(v as number), n as string]} contentStyle={TOOLTIP} />
          <Legend formatter={(val) => <span style={{ color: "#9ca3af", fontSize: 12 }}>{val}</span>} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function MarketingCharts({ data }: { data: MarketingReport }) {
  const series = data.series.map((r) => ({ name: fmtDate(r.name), users: r.value, sessions: r.secondary ?? 0 }))

  return (
    <div className="space-y-6">
      <Card title="Visitors over time">
        <div style={{ height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 6, right: 16, left: 0, bottom: 4 }}>
              <XAxis dataKey="name" tick={{ fill: "#9ca3af", fontSize: 12 }} axisLine={false} tickLine={false} minTickGap={24} />
              <YAxis tick={{ fill: "#9ca3af", fontSize: 12 }} axisLine={false} tickLine={false} width={40} />
              <Tooltip contentStyle={TOOLTIP} cursor={{ stroke: "rgba(255,255,255,0.1)" }} />
              <Legend formatter={(v) => <span style={{ color: "#9ca3af", fontSize: 12 }}>{v}</span>} />
              <Line type="monotone" dataKey="users" name="Active users" stroke="#ec4899" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="sessions" name="Sessions" stroke="#2AB4A6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Traffic by channel" csv={{ rows: data.channels, filename: "channels.csv" }}><HBars data={data.channels} colour="#ec4899" suffix="sessions" /></Card>
        <Card title="Top sources" csv={{ rows: data.sources, filename: "sources.csv" }}><HBars data={data.sources} colour="#6366f1" suffix="sessions" /></Card>
        <Card title="Top pages" csv={{ rows: data.pages, filename: "top-pages.csv" }}><HBars data={data.pages} colour="#2AB4A6" suffix="views" /></Card>
        <Card title="Top landing pages" csv={{ rows: data.landingPages, filename: "landing-pages.csv" }}><HBars data={data.landingPages} colour="#06b6d4" suffix="sessions" /></Card>
        <Card title="Events" csv={{ rows: data.events, filename: "events.csv" }}><HBars data={data.events} colour="#a855f7" suffix="count" /></Card>
        <Card title="Top countries" csv={{ rows: data.countries, filename: "countries.csv" }}><HBars data={data.countries} colour="#f59e0b" suffix="users" /></Card>
        <Card title="Devices"><Donut data={data.devices} /></Card>
        <Card title="New vs returning"><Donut data={data.newReturning} /></Card>
      </div>
    </div>
  )
}

"use client"

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from "recharts"

// Horizontal bars of total idle time per reason, coloured by the reason's own
// configured colour.
export function ReasonBreakdownChart({ data }: { data: { name: string; ms: number; colour: string }[] }) {
  if (!data.length) return <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">No idle reasons logged in this period.</p>
  const chartData = data.map(d => ({ ...d, mins: Math.round(d.ms / 60000) }))
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 46)}>
      <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 48, top: 4, bottom: 4 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Tooltip formatter={(v: any) => [`${v} min`, "Idle"]} cursor={{ fill: "rgba(148,163,184,0.1)" }} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Bar dataKey="mins" radius={[0, 4, 4, 0]}>
          {chartData.map((d, i) => <Cell key={i} fill={d.colour} />)}
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <LabelList dataKey="mins" position="right" formatter={(v: any) => `${v}m`} style={{ fontSize: 11, fill: "#9ca3af" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// Idle minutes per day across the range.
export function IdleTrendChart({ data }: { data: { day: string; ms: number }[] }) {
  if (!data.length) return <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">No idle in this period.</p>
  const chartData = data.map(d => ({ day: d.day, mins: Math.round(d.ms / 60000) }))
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData} margin={{ left: 4, right: 8, top: 8, bottom: 4 }}>
        <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={36} />
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Tooltip formatter={(v: any) => [`${v} min`, "Idle"]} cursor={{ fill: "rgba(148,163,184,0.1)" }} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Bar dataKey="mins" fill="#f59e0b" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

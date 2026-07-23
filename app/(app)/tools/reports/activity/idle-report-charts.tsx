"use client"

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from "recharts"

/* eslint-disable @typescript-eslint/no-explicit-any */
const tip = { fontSize: 12, borderRadius: 8 }
const axisTick = { fontSize: 11, fill: "#9ca3af" }

// Horizontal bars of total idle time per reason, coloured by each reason's colour.
export function ReasonBreakdownChart({ data }: { data: { name: string; ms: number; colour: string }[] }) {
  if (!data.length) return <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">No activity reasons logged in this period.</p>
  const chartData = data.map(d => ({ ...d, mins: Math.round(d.ms / 60000) }))
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 46)}>
      <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 48, top: 4, bottom: 4 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" width={130} tick={axisTick} axisLine={false} tickLine={false} />
        <Tooltip formatter={(v: any) => [`${v} min`, "Away"]} cursor={{ fill: "rgba(148,163,184,0.1)" }} contentStyle={tip} />
        <Bar dataKey="mins" radius={[0, 4, 4, 0]}>
          {chartData.map((d, i) => <Cell key={i} fill={d.colour} />)}
          <LabelList dataKey="mins" position="right" formatter={(v: any) => `${v}m`} style={{ fontSize: 11, fill: "#9ca3af" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// Idle minutes per day across the range.
export function IdleTrendChart({ data }: { data: { day: string; ms: number }[] }) {
  if (!data.length) return <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">No time away in this period.</p>
  const chartData = data.map(d => ({ day: d.day, mins: Math.round(d.ms / 60000) }))
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData} margin={{ left: 4, right: 8, top: 8, bottom: 4 }}>
        <XAxis dataKey="day" tick={axisTick} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={axisTick} axisLine={false} tickLine={false} width={36} />
        <Tooltip formatter={(v: any) => [`${v} min`, "Away"]} cursor={{ fill: "rgba(148,163,184,0.1)" }} contentStyle={tip} />
        <Bar dataKey="mins" fill="#f59e0b" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// Idle minutes by hour of the working day (9am–5pm) — shows when idle peaks.
export function IdleByHourChart({ data }: { data: { label: string; ms: number }[] }) {
  if (!data.some(d => d.ms > 0)) return <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">No time away in this period.</p>
  const chartData = data.map(d => ({ label: d.label, mins: Math.round(d.ms / 60000) }))
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData} margin={{ left: 4, right: 8, top: 8, bottom: 4 }}>
        <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
        <YAxis tick={axisTick} axisLine={false} tickLine={false} width={36} />
        <Tooltip formatter={(v: any) => [`${v} min`, "Away"]} cursor={{ fill: "rgba(148,163,184,0.1)" }} contentStyle={tip} />
        <Bar dataKey="mins" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// Idle minutes by weekday (Mon–Fri).
export function IdleByWeekdayChart({ data }: { data: { label: string; ms: number }[] }) {
  if (!data.some(d => d.ms > 0)) return <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">No time away in this period.</p>
  const chartData = data.map(d => ({ label: d.label, mins: Math.round(d.ms / 60000) }))
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData} margin={{ left: 4, right: 8, top: 8, bottom: 4 }}>
        <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
        <YAxis tick={axisTick} axisLine={false} tickLine={false} width={36} />
        <Tooltip formatter={(v: any) => [`${v} min`, "Away"]} cursor={{ fill: "rgba(148,163,184,0.1)" }} contentStyle={tip} />
        <Bar dataKey="mins" fill="#14b8a6" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

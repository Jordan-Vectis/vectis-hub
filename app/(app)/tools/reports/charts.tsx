"use client"

import { useState } from "react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LabelList,
  Cell,
} from "recharts"

// ─── Types ────────────────────────────────────────────────────────────────────

export type UserChartData = {
  userId: string
  name: string
  totalLots: number
  dailyAvg: number
  avgMs: number
  completedDays: number
  wizardLots: number
  photoOnlyLots: number
  lotsThisWeek: number
  lotsToday: number
}

export type MonthBucket = { month: string; total: number }

type View = "dailyAvg" | "totalLots" | "avgSpeed"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  if (ms <= 0) return "—"
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

// ─── Custom label ─────────────────────────────────────────────────────────────

function CustomLabel({
  x, y, width, height, value, formatter,
}: {
  x?: number; y?: number; width?: number; height?: number
  value?: number; formatter: (v: number) => string
}) {
  if (value == null || width == null) return null
  return (
    <text
      x={(x ?? 0) + (width ?? 0) + 6}
      y={(y ?? 0) + (height ?? 0) / 2}
      dominantBaseline="middle"
      fill="#9ca3af"
      fontSize={12}
      fontFamily="monospace"
    >
      {formatter(value)}
    </text>
  )
}

// ─── Horizontal bar chart ─────────────────────────────────────────────────────

function HorizontalBars({
  data,
  valueKey,
  formatter,
  colour,
}: {
  data: { name: string; value: number }[]
  valueKey: string
  formatter: (v: number) => string
  colour: string
}) {
  const rowHeight = 44
  const chartHeight = Math.max(data.length * rowHeight + 40, 120)

  return (
    <div style={{ height: chartHeight }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 80, left: 8, bottom: 4 }}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            width={120}
            tick={{ fill: "#9ca3af", fontSize: 13 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(v) => [formatter(v as number ?? 0), valueKey]}
            contentStyle={{
              background: "#2C2C2E",
              border: "1px solid #374151",
              borderRadius: 8,
              color: "#f3f4f6",
              fontSize: 13,
            }}
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
          />
          <Bar dataKey="value" fill={colour} radius={[0, 4, 4, 0]} maxBarSize={28}>
            {data.map((_, i) => (
              <Cell key={i} fill={colour} />
            ))}
            <LabelList
              dataKey="value"
              position="right"
              content={(props: any) => (
                <CustomLabel {...props} formatter={formatter} />
              )}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CataloguingReportsCharts({
  users,
  monthlyBuckets,
}: {
  users: UserChartData[]
  monthlyBuckets: MonthBucket[]
}) {
  const [view, setView] = useState<View>("dailyAvg")

  const views: { key: View; label: string }[] = [
    { key: "dailyAvg",  label: "Daily Average" },
    { key: "totalLots", label: "Total Lots" },
    { key: "avgSpeed",  label: "Avg Speed" },
  ]

  // Build chart data for current view
  let chartData: { name: string; value: number }[] = []
  let barColour = "#2AB4A6"
  let formatter: (v: number) => string = String

  if (view === "dailyAvg") {
    chartData = [...users]
      .sort((a, b) => b.dailyAvg - a.dailyAvg)
      .map(u => ({ name: u.name, value: u.dailyAvg }))
    formatter = v => `${v} lots/day`
    barColour = "#2AB4A6"
  } else if (view === "totalLots") {
    chartData = [...users]
      .sort((a, b) => b.totalLots - a.totalLots)
      .map(u => ({ name: u.name, value: u.totalLots }))
    formatter = v => `${v} lots`
    barColour = "#2AB4A6"
  } else {
    // Avg speed — ascending (lower = faster)
    chartData = [...users]
      .filter(u => u.avgMs > 0)
      .sort((a, b) => a.avgMs - b.avgMs)
      .map(u => ({ name: u.name, value: u.avgMs }))
    formatter = v => fmtMs(v)
    barColour = "#22c55e"
  }

  // Monthly chart data
  const monthlyHeight = Math.max(monthlyBuckets.length * 36 + 80, 220)

  return (
    <div className="space-y-8">
      {/* Leaderboard chart */}
      <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h2 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Team Leaderboard
          </h2>
          <div className="flex gap-1.5 bg-gray-100 dark:bg-[#2C2C2E] rounded-lg p-1">
            {views.map(v => (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  view === v.key
                    ? "bg-[#2AB4A6] text-white"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        {chartData.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-sm text-center py-8">No data to display.</p>
        ) : (
          <HorizontalBars
            data={chartData}
            valueKey={view === "avgSpeed" ? "Avg Time" : view === "dailyAvg" ? "Daily Avg" : "Total Lots"}
            formatter={formatter}
            colour={barColour}
          />
        )}
      </div>

      {/* Monthly totals chart */}
      {monthlyBuckets.length > 0 && (
        <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl p-6">
          <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-6">
            Monthly Totals — Last 12 Months
          </h2>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={monthlyBuckets}
                margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
              >
                <XAxis
                  dataKey="month"
                  tick={{ fill: "#9ca3af", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "#9ca3af", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                />
                <Tooltip
                  formatter={(v) => [`${v as number ?? 0} lots`, "Total"]}
                  contentStyle={{
                    background: "#2C2C2E",
                    border: "1px solid #374151",
                    borderRadius: 8,
                    color: "#f3f4f6",
                    fontSize: 13,
                  }}
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                />
                <Bar dataKey="total" fill="#2AB4A6" radius={[4, 4, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}

"use client"

import { useState } from "react"

function ReportCard({ title, description, href, icon }: { title: string; description: string; href: string; icon: string }) {
  return (
    <div className="wh-card space-y-3">
      <div className="flex items-start gap-3">
        <span className="text-2xl">{icon}</span>
        <div>
          <p className="font-semibold text-gray-900 dark:text-white">{title}</p>
          <p className="text-sm text-gray-500">{description}</p>
        </div>
      </div>
      <a href={href} download className="wh-btn-primary wh-btn-sm inline-flex">⬇ Download Excel</a>
    </div>
  )
}

export default function ReportsPage() {
  const [receiptFilters, setReceiptFilters] = useState({ date_from: "", date_to: "", customer_id: "" })
  const [movFilters, setMovFilters] = useState({ date_from: "", date_to: "" })

  function buildParams(filters: Record<string, string>) {
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v) })
    return params.toString()
  }

  return (
    <div className="p-6 max-w-3xl space-y-6" style={{ fontFamily: "Arial, sans-serif" }}>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Reports</h1>

      <ReportCard
        title="Full Stock Report"
        description="All totes and pallets with their current warehouse location."
        href="/api/warehouse/reports/stock"
        icon="📦"
      />

      <div className="wh-card space-y-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl">📋</span>
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">Receipts Report</p>
            <p className="text-sm text-gray-500">All receipts with commission rates and container counts.</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="wh-label">From</label>
            <input type="date" className="wh-input" value={receiptFilters.date_from}
              onChange={e => setReceiptFilters(f => ({ ...f, date_from: e.target.value }))} />
          </div>
          <div>
            <label className="wh-label">To</label>
            <input type="date" className="wh-input" value={receiptFilters.date_to}
              onChange={e => setReceiptFilters(f => ({ ...f, date_to: e.target.value }))} />
          </div>
          <div>
            <label className="wh-label">Customer ID</label>
            <input className="wh-input font-mono" placeholder="c00001" value={receiptFilters.customer_id}
              onChange={e => setReceiptFilters(f => ({ ...f, customer_id: e.target.value }))} />
          </div>
        </div>
        <a href={`/api/warehouse/reports/receipts?${buildParams(receiptFilters)}`} download className="wh-btn-primary wh-btn-sm inline-flex">
          ⬇ Download Excel
        </a>
      </div>

      <div className="wh-card space-y-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl">📅</span>
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">Movement History Report</p>
            <p className="text-sm text-gray-500">All container movements with timestamps and operators.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="wh-label">From</label>
            <input type="date" className="wh-input" value={movFilters.date_from}
              onChange={e => setMovFilters(f => ({ ...f, date_from: e.target.value }))} />
          </div>
          <div>
            <label className="wh-label">To</label>
            <input type="date" className="wh-input" value={movFilters.date_to}
              onChange={e => setMovFilters(f => ({ ...f, date_to: e.target.value }))} />
          </div>
        </div>
        <a href={`/api/warehouse/reports/movements?${buildParams(movFilters)}`} download className="wh-btn-primary wh-btn-sm inline-flex">
          ⬇ Download Excel
        </a>
      </div>
    </div>
  )
}

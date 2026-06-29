"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { createAuction } from "@/lib/actions/catalogue"
import { AUCTION_TYPES } from "@/lib/auction-types"

export default function NewAuctionButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    try {
      const fd = new FormData(e.currentTarget)
      const id = await createAuction(fd)
      router.push(`/tools/cataloguing/auctions/${id}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="bg-[#2AB4A6] hover:bg-[#24a090] text-white font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
      >
        + New Auction
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <div className="relative bg-[#1C1C1E] border border-gray-700 rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <h2 className="text-lg font-semibold text-gray-100 mb-4">New Auction</h2>
            <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Code *</label>
                  <input
                    name="code"
                    required
                    placeholder="e.g. VEC001"
                    className="w-full rounded-lg border border-gray-700 bg-[#2C2C2E] px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6] uppercase"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Date</label>
                  <input
                    name="auctionDate"
                    type="date"
                    className="w-full rounded-lg border border-gray-700 bg-[#2C2C2E] px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6]"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Name *</label>
                <input
                  name="name"
                  required
                  placeholder="Auction name"
                  className="w-full rounded-lg border border-gray-700 bg-[#2C2C2E] px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Type</label>
                <select
                  name="auctionType"
                  defaultValue="GENERAL"
                  className="w-full rounded-lg border border-gray-700 bg-[#2C2C2E] px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6]"
                >
                  {AUCTION_TYPES.map(({ value, label, emoji }) => (
                    <option key={value} value={value}>{emoji} {label}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex-1 rounded-lg border border-gray-700 bg-[#2C2C2E] px-4 py-2 text-sm font-medium text-gray-400 hover:bg-[#3C3C3E] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-50 text-white font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
                >
                  {loading ? "Creating..." : "Create Auction"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

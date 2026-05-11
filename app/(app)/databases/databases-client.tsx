"use client"

import { useState, useMemo, useTransition, useRef, useEffect } from "react"
import { updateContactDb, updateReceiptDb, updateContainerDb, moveContainerDb, updateLotDb } from "@/lib/actions/databases"

// ── Types ──────────────────────────────────────────────────────────────────

type ContactRow = {
  id: string; name: string; email: string | null; phone: string | null
  notes: string | null; isBuyer: boolean; isSeller: boolean
}
type ReceiptRow = {
  id: string; contactId: string; contactName: string
  commissionRate: number; notes: string | null; status: string; containerCount: number
}
type ContainerRow = {
  id: string; type: string; description: string
  category: string | null; subcategory: string | null
  receiptId: string; contactId: string; contactName: string; lastLocation: string | null
}
type LotRow = {
  id: string; lotNumber: string; title: string; description: string
  auctionId: string; auctionCode: string; auctionName: string
  vendor: string | null; receipt: string | null; tote: string | null
  category: string | null; subCategory: string | null; status: string
  condition: string | null; notes: string | null; brand: string | null
  estimateLow: number | null; estimateHigh: number | null
  reserve: number | null; hammerPrice: number | null; imageCount: number
}
type AuctionOption = { id: string; code: string; name: string }
type Tab = "customers" | "receipts" | "totes" | "lots" | "bids" | "browse"

type BidRow = {
  id: string
  lotId: string
  lotNumber: string
  lotTitle: string
  estimateLow: number | null
  estimateHigh: number | null
  hammerPrice: number | null
  lotStatus: string
  auctionId: string
  auctionCode: string
  auctionName: string
  customerAccountId: string
  customerEmail: string
  customerName: string
  contactId: string | null
  maxBid: number
  placedAt: string
  updatedAt: string
}

interface Props {
  contacts:       ContactRow[]
  receipts:       ReceiptRow[]
  containers:     ContainerRow[]
  lots:           LotRow[]
  auctions:       AuctionOption[]
  locations:      string[]
  commissionBids: BidRow[]
}

// ── Shared UI bits ─────────────────────────────────────────────────────────

const COL_INPUT  = "w-full rounded border border-gray-700 bg-[#111113] px-2 py-1 text-xs text-gray-300 placeholder-gray-700 focus:outline-none focus:ring-1 focus:ring-violet-500"
const COL_SELECT = "w-full rounded border border-gray-700 bg-[#111113] px-1 py-1 text-xs text-gray-300 focus:outline-none focus:ring-1 focus:ring-violet-500"
const EDIT_INPUT = "w-full rounded-lg border border-gray-700 bg-[#2C2C2E] px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500"
const EDIT_SELECT = "w-full rounded-lg border border-gray-700 bg-[#2C2C2E] px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500"

function match(value: string | null | undefined, filter: string) {
  if (!filter.trim()) return true
  return (value ?? "").toLowerCase().includes(filter.toLowerCase().trim())
}

function EField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)}
      className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${checked ? "border-violet-500 bg-violet-500/20 text-violet-300" : "border-gray-700 text-gray-500 hover:border-gray-500"}`}>
      {label}
    </button>
  )
}

function Badge({ children, color = "gray" }: { children: React.ReactNode; color?: "gray"|"green"|"blue"|"amber"|"red"|"violet" }) {
  const s: Record<string, string> = {
    gray:   "bg-gray-800 text-gray-400",
    green:  "bg-green-900/40 text-green-400",
    blue:   "bg-blue-900/40 text-blue-400",
    amber:  "bg-amber-900/40 text-amber-400",
    red:    "bg-red-900/40 text-red-400",
    violet: "bg-violet-900/40 text-violet-400",
  }
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${s[color]}`}>{children}</span>
}

function statusBadge(status: string) {
  const s = status.toUpperCase()
  if (s === "OPEN"  || s === "ENTERED")  return <Badge color="green">{status}</Badge>
  if (s === "SOLD"  || s === "CLOSED")   return <Badge color="blue">{status}</Badge>
  if (s === "WITHDRAWN")                 return <Badge color="red">{status}</Badge>
  return <Badge>{status}</Badge>
}

// ── Column Picker ──────────────────────────────────────────────────────────

function ColumnPicker({ columns, visible, onToggle }: {
  columns: { key: string; label: string }[]
  visible: Set<string>
  onToggle: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-700 bg-[#1C1C1E] text-xs text-gray-400 hover:border-gray-500 hover:text-gray-300 transition-colors">
        <span>⚙</span> Columns
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 bg-[#1C1C1E] border border-gray-700 rounded-xl shadow-xl p-3 min-w-[160px]">
          <p className="text-xs text-gray-600 mb-2 px-1">Show / hide columns</p>
          {columns.map(col => (
            <label key={col.key} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-gray-800 cursor-pointer">
              <input type="checkbox" checked={visible.has(col.key)} onChange={() => onToggle(col.key)}
                className="accent-violet-500" />
              <span className="text-xs text-gray-300">{col.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Edit Panels ────────────────────────────────────────────────────────────

function ContactEditPanel({ row, onClose, onSaved }: { row: ContactRow; onClose: () => void; onSaved: (updated: ContactRow) => void }) {
  const [name, setName]         = useState(row.name)
  const [email, setEmail]       = useState(row.email ?? "")
  const [phone, setPhone]       = useState(row.phone ?? "")
  const [notes, setNotes]       = useState(row.notes ?? "")
  const [isBuyer, setIsBuyer]   = useState(row.isBuyer)
  const [isSeller, setIsSeller] = useState(row.isSeller)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function save() {
    start(async () => {
      try {
        await updateContactDb(row.id, { name: name.trim(), email: email.trim() || undefined, phone: phone.trim() || undefined, notes: notes.trim() || undefined, isBuyer, isSeller })
        onSaved({ ...row, name: name.trim(), email: email.trim() || null, phone: phone.trim() || null, notes: notes.trim() || null, isBuyer, isSeller })
        onClose()
      } catch (e) { setError(e instanceof Error ? e.message : "Save failed") }
    })
  }

  return (
    <div className="space-y-4">
      <EField label="Name"><input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" className={EDIT_INPUT} /></EField>
      <EField label="Email"><input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="email@example.com" className={EDIT_INPUT} /></EField>
      <EField label="Phone"><input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+44..." className={EDIT_INPUT} /></EField>
      <EField label="Notes"><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className={`${EDIT_INPUT} resize-none`} /></EField>
      <div className="flex gap-2">
        <Toggle label="Buyer"  checked={isBuyer}  onChange={setIsBuyer}  />
        <Toggle label="Seller" checked={isSeller} onChange={setIsSeller} />
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-3 pt-1">
        <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-gray-700 text-gray-400 text-sm hover:border-gray-500 transition-colors">Cancel</button>
        <button onClick={save} disabled={pending} className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors">{pending ? "Saving…" : "Save"}</button>
      </div>
    </div>
  )
}

function ReceiptEditPanel({ row, onClose, onSaved }: { row: ReceiptRow; onClose: () => void; onSaved: (updated: ReceiptRow) => void }) {
  const [commission, setCommission] = useState(String(row.commissionRate))
  const [notes, setNotes]           = useState(row.notes ?? "")
  const [status, setStatus]         = useState(row.status)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function save() {
    const rate = parseFloat(commission) || 0
    start(async () => {
      try {
        await updateReceiptDb(row.id, { commissionRate: rate, notes: notes.trim() || undefined, status })
        onSaved({ ...row, commissionRate: rate, notes: notes.trim() || null, status })
        onClose()
      } catch (e) { setError(e instanceof Error ? e.message : "Save failed") }
    })
  }

  return (
    <div className="space-y-4">
      <div className="bg-[#111113] rounded-lg border border-gray-800 px-4 py-3 text-sm space-y-1">
        <div><span className="text-gray-500">Contact: </span><span className="text-gray-200">{row.contactName}</span></div>
        <div><span className="text-gray-500 text-xs">ID: </span><span className="text-gray-600 font-mono text-xs">{row.id}</span></div>
      </div>
      <EField label="Status">
        <select value={status} onChange={e => setStatus(e.target.value)} className={EDIT_SELECT}>
          <option value="OPEN">Open</option>
          <option value="CLOSED">Closed</option>
          <option value="PENDING">Pending</option>
          <option value="open">open</option>
          <option value="closed">closed</option>
        </select>
      </EField>
      <EField label="Commission Rate (%)"><input value={commission} onChange={e => setCommission(e.target.value)} type="number" step="0.5" className={EDIT_INPUT} /></EField>
      <EField label="Notes"><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className={`${EDIT_INPUT} resize-none`} /></EField>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-3 pt-1">
        <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-gray-700 text-gray-400 text-sm hover:border-gray-500 transition-colors">Cancel</button>
        <button onClick={save} disabled={pending} className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors">{pending ? "Saving…" : "Save"}</button>
      </div>
    </div>
  )
}

function ContainerEditPanel({ row, locations, onClose, onSaved }: {
  row: ContainerRow; locations: string[]
  onClose: () => void; onSaved: (updated: ContainerRow) => void
}) {
  const [type,        setType]        = useState(row.type)
  const [description, setDescription] = useState(row.description)
  const [category,    setCategory]    = useState(row.category ?? "")
  const [subcategory, setSubcategory] = useState(row.subcategory ?? "")
  const [location,    setLocation]    = useState(row.lastLocation ?? "")
  const [locNotes,    setLocNotes]    = useState("")
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const locationChanged = location.trim() !== (row.lastLocation ?? "")

  function save() {
    start(async () => {
      try {
        await updateContainerDb(row.id, {
          type: type.trim() || undefined,
          description: description.trim() || undefined,
          category: category.trim() || undefined,
          subcategory: subcategory.trim() || undefined,
        })
        if (locationChanged && location.trim()) {
          await moveContainerDb(row.id, location.trim(), locNotes.trim() || undefined)
        }
        onSaved({ ...row, type: type.trim(), description: description.trim(), category: category.trim() || null, subcategory: subcategory.trim() || null, lastLocation: location.trim() || row.lastLocation })
        onClose()
      } catch (e) { setError(e instanceof Error ? e.message : "Save failed") }
    })
  }

  return (
    <div className="space-y-4">
      <div className="bg-[#111113] rounded-lg border border-gray-800 px-4 py-3 text-sm space-y-1">
        <div><span className="text-gray-500">Contact: </span><span className="text-gray-200">{row.contactName}</span></div>
        <div><span className="text-gray-500 text-xs">ID: </span><span className="text-gray-600 font-mono text-xs">{row.id}</span></div>
      </div>
      <EField label="Type"><input value={type} onChange={e => setType(e.target.value)} placeholder="e.g. TOTE, BOX…" className={EDIT_INPUT} /></EField>
      <EField label="Description"><input value={description} onChange={e => setDescription(e.target.value)} placeholder="Description" className={EDIT_INPUT} /></EField>
      <EField label="Category"><input value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. Furniture" className={EDIT_INPUT} /></EField>
      <EField label="Subcategory"><input value={subcategory} onChange={e => setSubcategory(e.target.value)} placeholder="e.g. Chairs" className={EDIT_INPUT} /></EField>

      <div className="border-t border-gray-800 pt-4">
        <p className="text-xs font-semibold text-gray-400 mb-3">📍 Location</p>
        <EField label="New location code">
          <input
            value={location}
            onChange={e => setLocation(e.target.value)}
            list="loc-list"
            placeholder={row.lastLocation ?? "Enter location…"}
            className={EDIT_INPUT}
          />
          <datalist id="loc-list">
            {locations.map(l => <option key={l} value={l} />)}
          </datalist>
          {locationChanged && location.trim() && (
            <p className="text-xs text-violet-400 mt-1">Will log a new movement → {location.trim()}</p>
          )}
        </EField>
        {locationChanged && location.trim() && (
          <div className="mt-3">
            <EField label="Movement notes (optional)">
              <input value={locNotes} onChange={e => setLocNotes(e.target.value)} placeholder="e.g. Moved for auction" className={EDIT_INPUT} />
            </EField>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-3 pt-1">
        <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-gray-700 text-gray-400 text-sm hover:border-gray-500 transition-colors">Cancel</button>
        <button onClick={save} disabled={pending} className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors">{pending ? "Saving…" : "Save"}</button>
      </div>
    </div>
  )
}

function LotEditPanel({ row, auctions, onClose, onSaved }: {
  row: LotRow; auctions: AuctionOption[]
  onClose: () => void; onSaved: (updated: LotRow) => void
}) {
  const [lotNumber,    setLotNumber]    = useState(row.lotNumber)
  const [title,        setTitle]        = useState(row.title)
  const [description,  setDescription]  = useState(row.description)
  const [auctionId,    setAuctionId]    = useState(row.auctionId)
  const [vendor,       setVendor]       = useState(row.vendor ?? "")
  const [receipt,      setReceipt]      = useState(row.receipt ?? "")
  const [tote,         setTote]         = useState(row.tote ?? "")
  const [category,     setCategory]     = useState(row.category ?? "")
  const [subCategory,  setSubCategory]  = useState(row.subCategory ?? "")
  const [condition,    setCondition]    = useState(row.condition ?? "")
  const [brand,        setBrand]        = useState(row.brand ?? "")
  const [notes,        setNotes]        = useState(row.notes ?? "")
  const [estimateLow,  setEstimateLow]  = useState(row.estimateLow != null ? String(row.estimateLow) : "")
  const [estimateHigh, setEstimateHigh] = useState(row.estimateHigh != null ? String(row.estimateHigh) : "")
  const [reserve,      setReserve]      = useState(row.reserve != null ? String(row.reserve) : "")
  const [hammerPrice,  setHammerPrice]  = useState(row.hammerPrice != null ? String(row.hammerPrice) : "")
  const [status,       setStatus]       = useState(row.status)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function num(v: string) { const n = parseInt(v); return isNaN(n) ? null : n }

  function save() {
    const selectedAuction = auctions.find(a => a.id === auctionId)
    start(async () => {
      try {
        await updateLotDb(row.id, {
          lotNumber: lotNumber.trim(), title: title.trim(), description: description.trim(),
          auctionId, vendor: vendor.trim() || null, receipt: receipt.trim() || null,
          tote: tote.trim() || null, category: category.trim() || null, subCategory: subCategory.trim() || null,
          condition: condition.trim() || null, brand: brand.trim() || null, notes: notes.trim() || null,
          estimateLow: num(estimateLow), estimateHigh: num(estimateHigh),
          reserve: num(reserve), hammerPrice: num(hammerPrice), status,
        })
        onSaved({
          ...row,
          lotNumber: lotNumber.trim(), title: title.trim(), description: description.trim(),
          auctionId, auctionCode: selectedAuction?.code ?? row.auctionCode, auctionName: selectedAuction?.name ?? row.auctionName,
          vendor: vendor.trim() || null, receipt: receipt.trim() || null, tote: tote.trim() || null,
          category: category.trim() || null, subCategory: subCategory.trim() || null,
          condition: condition.trim() || null, brand: brand.trim() || null, notes: notes.trim() || null,
          estimateLow: num(estimateLow), estimateHigh: num(estimateHigh),
          reserve: num(reserve), hammerPrice: num(hammerPrice), status,
        })
        onClose()
      } catch (e) { setError(e instanceof Error ? e.message : "Save failed") }
    })
  }

  return (
    <div className="space-y-4">
      {/* Identity */}
      <div className="grid grid-cols-2 gap-3">
        <EField label="Lot Number"><input value={lotNumber} onChange={e => setLotNumber(e.target.value)} className={EDIT_INPUT} /></EField>
        <EField label="Status">
          <select value={status} onChange={e => setStatus(e.target.value)} className={EDIT_SELECT}>
            {["ENTERED","CATALOGUED","APPROVED","SOLD","WITHDRAWN","PASSED"].map(s =>
              <option key={s} value={s}>{s}</option>
            )}
          </select>
        </EField>
      </div>
      <EField label="Title"><input value={title} onChange={e => setTitle(e.target.value)} className={EDIT_INPUT} /></EField>

      {/* Auction */}
      <EField label="Auction">
        <select value={auctionId} onChange={e => setAuctionId(e.target.value)} className={EDIT_SELECT}>
          {auctions.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
        </select>
      </EField>

      {/* Vendor / Receipt / Tote */}
      <div className="grid grid-cols-2 gap-3">
        <EField label="Vendor"><input value={vendor} onChange={e => setVendor(e.target.value)} className={EDIT_INPUT} /></EField>
        <EField label="Receipt"><input value={receipt} onChange={e => setReceipt(e.target.value)} className={EDIT_INPUT} /></EField>
      </div>
      <EField label="Tote"><input value={tote} onChange={e => setTote(e.target.value)} className={EDIT_INPUT} /></EField>

      {/* Category */}
      <div className="grid grid-cols-2 gap-3">
        <EField label="Category"><input value={category} onChange={e => setCategory(e.target.value)} className={EDIT_INPUT} /></EField>
        <EField label="Sub-category"><input value={subCategory} onChange={e => setSubCategory(e.target.value)} className={EDIT_INPUT} /></EField>
      </div>

      {/* Details */}
      <div className="grid grid-cols-2 gap-3">
        <EField label="Brand"><input value={brand} onChange={e => setBrand(e.target.value)} className={EDIT_INPUT} /></EField>
        <EField label="Condition"><input value={condition} onChange={e => setCondition(e.target.value)} className={EDIT_INPUT} /></EField>
      </div>

      {/* Pricing */}
      <p className="text-xs font-semibold text-gray-400 pt-1">£ Pricing</p>
      <div className="grid grid-cols-2 gap-3">
        <EField label="Est. Low"><input value={estimateLow} onChange={e => setEstimateLow(e.target.value)} type="number" className={EDIT_INPUT} /></EField>
        <EField label="Est. High"><input value={estimateHigh} onChange={e => setEstimateHigh(e.target.value)} type="number" className={EDIT_INPUT} /></EField>
        <EField label="Reserve"><input value={reserve} onChange={e => setReserve(e.target.value)} type="number" className={EDIT_INPUT} /></EField>
        <EField label="Hammer Price"><input value={hammerPrice} onChange={e => setHammerPrice(e.target.value)} type="number" className={EDIT_INPUT} /></EField>
      </div>

      {/* Description / Notes */}
      <EField label="Description"><textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className={`${EDIT_INPUT} resize-none`} /></EField>
      <EField label="Notes"><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={`${EDIT_INPUT} resize-none`} /></EField>

      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-3 pt-1">
        <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-gray-700 text-gray-400 text-sm hover:border-gray-500 transition-colors">Cancel</button>
        <button onClick={save} disabled={pending} className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors">{pending ? "Saving…" : "Save"}</button>
      </div>
    </div>
  )
}

// ── Drawer ─────────────────────────────────────────────────────────────────

function Drawer({ title, subtitle, open, onClose, children }: {
  title: string; subtitle?: string; open: boolean; onClose: () => void; children: React.ReactNode
}) {
  return (
    <>
      {open && <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />}
      <div className={`fixed inset-y-0 right-0 z-50 w-full max-w-sm bg-[#18181B] border-l border-gray-800 flex flex-col transition-transform duration-300 ${open ? "translate-x-0" : "translate-x-full"}`}>
        <div className="flex items-start justify-between p-5 border-b border-gray-800 shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-gray-100">{title}</h3>
            {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg leading-none ml-4">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────

export default function DatabasesClient({ contacts: initialContacts, receipts: initialReceipts, containers: initialContainers, lots: initialLots, auctions, locations, commissionBids: initialBids }: Props) {
  const [tab, setTab] = useState<Tab>("customers")

  // Local copies for optimistic updates
  const [contacts,   setContacts]   = useState(initialContacts)
  const [receipts,   setReceipts]   = useState(initialReceipts)
  const [containers, setContainers] = useState(initialContainers)
  const [lots,       setLots]       = useState(initialLots)
  const [bids]                      = useState(initialBids)

  // ── Column visibility ───────────────────────────────────────────────────
  const CUSTOMER_COLS  = [
    { key: "name",   label: "Name"   },
    { key: "email",  label: "Email"  },
    { key: "phone",  label: "Phone"  },
    { key: "notes",  label: "Notes"  },
    { key: "buyer",  label: "Buyer"  },
    { key: "seller", label: "Seller" },
  ]
  const RECEIPT_COLS = [
    { key: "id",         label: "ID"         },
    { key: "contact",    label: "Contact"    },
    { key: "commission", label: "Commission" },
    { key: "totes",      label: "Totes"      },
    { key: "notes",      label: "Notes"      },
    { key: "status",     label: "Status"     },
  ]
  const TOTE_COLS = [
    { key: "id",         label: "ID"          },
    { key: "type",       label: "Type"        },
    { key: "description",label: "Description" },
    { key: "contact",    label: "Contact"     },
    { key: "category",   label: "Category"    },
    { key: "location",   label: "Location"    },
  ]
  const LOT_COLS = [
    { key: "lotNumber",  label: "Lot No."     },
    { key: "title",      label: "Title"       },
    { key: "auction",    label: "Auction"     },
    { key: "vendor",     label: "Vendor"      },
    { key: "receipt",    label: "Receipt"     },
    { key: "tote",       label: "Tote"        },
    { key: "category",   label: "Category"    },
    { key: "condition",  label: "Condition"   },
    { key: "estimate",   label: "Estimate"    },
    { key: "photos",     label: "Photos"      },
    { key: "status",     label: "Status"      },
  ]

  const [visCust,  setVisCust]  = useState<Set<string>>(new Set(["name","email","phone","buyer","seller"]))
  const [visRcpt,  setVisRcpt]  = useState<Set<string>>(new Set(["id","contact","commission","totes","status"]))
  const [visTote,  setVisTote]  = useState<Set<string>>(new Set(["id","type","description","contact","category","location"]))
  const [visLot,   setVisLot]   = useState<Set<string>>(new Set(["lotNumber","title","auction","vendor","tote","photos","status"]))

  function toggleCol(setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) {
    setter(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next })
  }

  // ── Per-column filters ──────────────────────────────────────────────────
  const [cName,    setCName]    = useState("")
  const [cEmail,   setCEmail]   = useState("")
  const [cPhone,   setCPhone]   = useState("")
  const [cBuyer,   setCBuyer]   = useState("")
  const [cSeller,  setCSeller]  = useState("")

  const [rId,      setRId]      = useState("")
  const [rContact, setRContact] = useState("")
  const [rComm,    setRComm]    = useState("")
  const [rStatus,  setRStatus]  = useState("")

  const [tId,       setTId]       = useState("")
  const [tType,     setTType]     = useState("")
  const [tDesc,     setTDesc]     = useState("")
  const [tContact,  setTContact]  = useState("")
  const [tCategory, setTCategory] = useState("")
  const [tLocation, setTLocation] = useState("")

  const [lLotNo,   setLLotNo]   = useState("")
  const [lTitle,   setLTitle]   = useState("")
  const [lAuction, setLAuction] = useState("")
  const [lVendor,  setLVendor]  = useState("")
  const [lReceipt, setLReceipt] = useState("")
  const [lTote,    setLTote]    = useState("")
  const [lStatus,  setLStatus]  = useState("")

  const [bAuction,  setBAuction]  = useState("")
  const [bCustomer, setBCustomer] = useState("")
  const [bContact,  setBContact]  = useState("")
  const [bStatus,   setBStatus]   = useState("")

  // ── Edit drawer ─────────────────────────────────────────────────────────
  const [editContact,   setEditContact]   = useState<ContactRow | null>(null)
  const [editReceipt,   setEditReceipt]   = useState<ReceiptRow | null>(null)
  const [editContainer, setEditContainer] = useState<ContainerRow | null>(null)
  const [editLot,       setEditLot]       = useState<LotRow | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  function flash() { setSavedFlash(true); setTimeout(() => setSavedFlash(false), 2000) }

  // ── Filtered data ───────────────────────────────────────────────────────
  const filteredContacts = useMemo(() => contacts.filter(c =>
    match(c.name, cName) && match(c.email, cEmail) && match(c.phone, cPhone) &&
    (cBuyer  === "" || (cBuyer  === "yes" ? c.isBuyer  : !c.isBuyer))  &&
    (cSeller === "" || (cSeller === "yes" ? c.isSeller : !c.isSeller))
  ), [contacts, cName, cEmail, cPhone, cBuyer, cSeller])

  const filteredReceipts = useMemo(() => receipts.filter(r =>
    match(r.id, rId) && match(r.contactName, rContact) &&
    match(String(r.commissionRate), rComm) &&
    (rStatus === "" || r.status === rStatus)
  ), [receipts, rId, rContact, rComm, rStatus])

  const filteredContainers = useMemo(() => containers.filter(c =>
    match(c.id, tId) && (tType === "" || c.type === tType) &&
    match(c.description, tDesc) && match(c.contactName, tContact) &&
    match(c.category, tCategory) && match(c.lastLocation, tLocation)
  ), [containers, tId, tType, tDesc, tContact, tCategory, tLocation])

  const filteredLots = useMemo(() => lots.filter(l =>
    match(l.lotNumber, lLotNo) && match(l.title, lTitle) &&
    (lAuction === "" || l.auctionCode === lAuction) &&
    match(l.vendor, lVendor) && match(l.receipt, lReceipt) &&
    match(l.tote, lTote) && (lStatus === "" || l.status === lStatus)
  ), [lots, lLotNo, lTitle, lAuction, lVendor, lReceipt, lTote, lStatus])

  const filteredBids = useMemo(() => bids.filter(b =>
    (bAuction  === "" || b.auctionCode === bAuction) &&
    (match(b.customerName, bCustomer) || match(b.customerEmail, bCustomer)) &&
    (bContact  === "" || match(b.contactId, bContact)) &&
    (bStatus   === "" || b.lotStatus === bStatus)
  ), [bids, bAuction, bCustomer, bContact, bStatus])

  // Dropdown options
  const toteTypes      = useMemo(() => Array.from(new Set(containers.map(c => c.type))).sort(), [containers])
  const auctionCodes   = useMemo(() => Array.from(new Set(lots.map(l => l.auctionCode))).sort(), [lots])
  const lotStatuses    = useMemo(() => Array.from(new Set(lots.map(l => l.status))).sort(), [lots])
  const receiptStatuses = useMemo(() => Array.from(new Set(receipts.map(r => r.status))).sort(), [receipts])

  function clearFilters() {
    setCName(""); setCEmail(""); setCPhone(""); setCBuyer(""); setCSeller("")
    setRId(""); setRContact(""); setRComm(""); setRStatus("")
    setTId(""); setTType(""); setTDesc(""); setTContact(""); setTCategory(""); setTLocation("")
    setLLotNo(""); setLTitle(""); setLAuction(""); setLVendor(""); setLReceipt(""); setLTote(""); setLStatus("")
    setBAuction(""); setBCustomer(""); setBContact(""); setBStatus("")
  }

  const bidAuctionCodes = useMemo(() => Array.from(new Set(bids.map(b => b.auctionCode))).sort(), [bids])
  const bidLotStatuses  = useMemo(() => Array.from(new Set(bids.map(b => b.lotStatus))).sort(), [bids])

  const tabs: { key: Tab; label: string; count: number; filtered: number }[] = [
    { key: "customers", label: "Customers",       count: contacts.length,   filtered: filteredContacts.length   },
    { key: "receipts",  label: "Receipts",        count: receipts.length,   filtered: filteredReceipts.length   },
    { key: "totes",     label: "Totes",           count: containers.length, filtered: filteredContainers.length },
    { key: "lots",      label: "Lots",            count: lots.length,       filtered: filteredLots.length       },
    { key: "bids",      label: "Commission Bids", count: bids.length,       filtered: filteredBids.length       },
    { key: "browse",    label: "Browse Any Table", count: 0,                filtered: 0                          },
  ]

  // ── Row classes ──────────────────────────────────────────────────────────
  const TR = (i: number) => `cursor-pointer border-b border-gray-800/50 hover:bg-violet-900/10 transition-colors ${i % 2 === 0 ? "" : "bg-[#1C1C1E]/30"}`

  return (
    <div className="min-h-screen bg-[#0D0D0F] text-gray-100">
      <div className="max-w-7xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-100">Databases</h1>
            <p className="text-xs text-gray-500 mt-0.5">Filter any column · click a row to edit</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {savedFlash && <span className="text-sm font-semibold text-violet-400 animate-pulse">✓ Saved</span>}
            <button onClick={clearFilters} className="text-xs text-gray-600 hover:text-gray-400 transition-colors">Clear filters</button>
            {tab === "customers" && <ColumnPicker columns={CUSTOMER_COLS} visible={visCust} onToggle={k => toggleCol(setVisCust, k)} />}
            {tab === "receipts"  && <ColumnPicker columns={RECEIPT_COLS}  visible={visRcpt} onToggle={k => toggleCol(setVisRcpt, k)} />}
            {tab === "totes"     && <ColumnPicker columns={TOTE_COLS}     visible={visTote} onToggle={k => toggleCol(setVisTote, k)} />}
            {tab === "lots"      && <ColumnPicker columns={LOT_COLS}      visible={visLot}  onToggle={k => toggleCol(setVisLot,  k)} />}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-800 overflow-x-auto scrollbar-none">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${tab === t.key ? "border-violet-500 text-violet-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}>
              {t.label}
              <span className="ml-1.5 text-xs text-gray-600">
                {t.filtered < t.count ? `${t.filtered.toLocaleString()} / ${t.count.toLocaleString()}` : t.count.toLocaleString()}
              </span>
            </button>
          ))}
        </div>

        {/* ── Customers ── */}
        {tab === "customers" && (
          <div className="overflow-x-auto rounded-b-xl rounded-tr-xl border border-gray-800 border-t-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-[#1C1C1E]">
                  {visCust.has("name")   && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Name</th>}
                  {visCust.has("email")  && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Email</th>}
                  {visCust.has("phone")  && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Phone</th>}
                  {visCust.has("notes")  && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Notes</th>}
                  {visCust.has("buyer")  && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Buyer</th>}
                  {visCust.has("seller") && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Seller</th>}
                </tr>
                <tr className="border-b border-gray-900 bg-[#111113]">
                  {visCust.has("name")   && <td className="px-2 py-1.5"><input value={cName}  onChange={e => setCName(e.target.value)}  placeholder="Filter…" className={COL_INPUT} /></td>}
                  {visCust.has("email")  && <td className="px-2 py-1.5"><input value={cEmail} onChange={e => setCEmail(e.target.value)} placeholder="Filter…" className={COL_INPUT} /></td>}
                  {visCust.has("phone")  && <td className="px-2 py-1.5"><input value={cPhone} onChange={e => setCPhone(e.target.value)} placeholder="Filter…" className={COL_INPUT} /></td>}
                  {visCust.has("notes")  && <td className="px-2 py-1.5"></td>}
                  {visCust.has("buyer")  && <td className="px-2 py-1.5"><select value={cBuyer}  onChange={e => setCBuyer(e.target.value)}  className={COL_SELECT}><option value="">All</option><option value="yes">Yes</option><option value="no">No</option></select></td>}
                  {visCust.has("seller") && <td className="px-2 py-1.5"><select value={cSeller} onChange={e => setCSeller(e.target.value)} className={COL_SELECT}><option value="">All</option><option value="yes">Yes</option><option value="no">No</option></select></td>}
                </tr>
              </thead>
              <tbody>
                {filteredContacts.map((c, i) => (
                  <tr key={c.id} onClick={() => setEditContact(c)} className={TR(i)}>
                    {visCust.has("name")   && <td className="px-3 py-2.5 text-gray-200 font-medium">{c.name}</td>}
                    {visCust.has("email")  && <td className="px-3 py-2.5 text-gray-400">{c.email ?? <span className="text-gray-700">—</span>}</td>}
                    {visCust.has("phone")  && <td className="px-3 py-2.5 text-gray-400">{c.phone ?? <span className="text-gray-700">—</span>}</td>}
                    {visCust.has("notes")  && <td className="px-3 py-2.5 text-gray-600 max-w-[200px] truncate text-xs">{c.notes ?? "—"}</td>}
                    {visCust.has("buyer")  && <td className="px-3 py-2.5">{c.isBuyer  ? <Badge color="green">Yes</Badge> : <span className="text-gray-700 text-xs">—</span>}</td>}
                    {visCust.has("seller") && <td className="px-3 py-2.5">{c.isSeller ? <Badge color="blue">Yes</Badge>  : <span className="text-gray-700 text-xs">—</span>}</td>}
                  </tr>
                ))}
                {filteredContacts.length === 0 && <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-600 text-sm">No customers match your filters</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Receipts ── */}
        {tab === "receipts" && (
          <div className="overflow-x-auto rounded-b-xl rounded-tr-xl border border-gray-800 border-t-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-[#1C1C1E]">
                  {visRcpt.has("id")         && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">ID</th>}
                  {visRcpt.has("contact")    && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Contact</th>}
                  {visRcpt.has("commission") && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Commission %</th>}
                  {visRcpt.has("totes")      && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Totes</th>}
                  {visRcpt.has("notes")      && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Notes</th>}
                  {visRcpt.has("status")     && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>}
                </tr>
                <tr className="border-b border-gray-900 bg-[#111113]">
                  {visRcpt.has("id")         && <td className="px-2 py-1.5"><input value={rId}      onChange={e => setRId(e.target.value)}      placeholder="Filter…" className={COL_INPUT} /></td>}
                  {visRcpt.has("contact")    && <td className="px-2 py-1.5"><input value={rContact} onChange={e => setRContact(e.target.value)} placeholder="Filter…" className={COL_INPUT} /></td>}
                  {visRcpt.has("commission") && <td className="px-2 py-1.5"><input value={rComm}    onChange={e => setRComm(e.target.value)}    placeholder="Filter…" className={COL_INPUT} /></td>}
                  {visRcpt.has("totes")      && <td className="px-2 py-1.5"></td>}
                  {visRcpt.has("notes")      && <td className="px-2 py-1.5"></td>}
                  {visRcpt.has("status")     && <td className="px-2 py-1.5"><select value={rStatus} onChange={e => setRStatus(e.target.value)} className={COL_SELECT}><option value="">All</option>{receiptStatuses.map(s => <option key={s} value={s}>{s}</option>)}</select></td>}
                </tr>
              </thead>
              <tbody>
                {filteredReceipts.map((r, i) => (
                  <tr key={r.id} onClick={() => setEditReceipt(r)} className={TR(i)}>
                    {visRcpt.has("id")         && <td className="px-3 py-2.5 text-gray-500 font-mono text-xs">{r.id.slice(0, 10)}…</td>}
                    {visRcpt.has("contact")    && <td className="px-3 py-2.5 text-gray-200">{r.contactName}</td>}
                    {visRcpt.has("commission") && <td className="px-3 py-2.5 text-gray-400">{r.commissionRate}%</td>}
                    {visRcpt.has("totes")      && <td className="px-3 py-2.5 text-gray-400">{r.containerCount}</td>}
                    {visRcpt.has("notes")      && <td className="px-3 py-2.5 text-gray-600 max-w-[180px] truncate text-xs">{r.notes ?? "—"}</td>}
                    {visRcpt.has("status")     && <td className="px-3 py-2.5">{statusBadge(r.status)}</td>}
                  </tr>
                ))}
                {filteredReceipts.length === 0 && <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-600 text-sm">No receipts match your filters</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Totes ── */}
        {tab === "totes" && (
          <div className="overflow-x-auto rounded-b-xl rounded-tr-xl border border-gray-800 border-t-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-[#1C1C1E]">
                  {visTote.has("id")          && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">ID</th>}
                  {visTote.has("type")        && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Type</th>}
                  {visTote.has("description") && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Description</th>}
                  {visTote.has("contact")     && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Contact</th>}
                  {visTote.has("category")    && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Category</th>}
                  {visTote.has("location")    && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Location</th>}
                </tr>
                <tr className="border-b border-gray-900 bg-[#111113]">
                  {visTote.has("id")          && <td className="px-2 py-1.5"><input value={tId}      onChange={e => setTId(e.target.value)}      placeholder="Filter…" className={COL_INPUT} /></td>}
                  {visTote.has("type")        && <td className="px-2 py-1.5"><select value={tType} onChange={e => setTType(e.target.value)} className={COL_SELECT}><option value="">All</option>{toteTypes.map(t => <option key={t} value={t}>{t}</option>)}</select></td>}
                  {visTote.has("description") && <td className="px-2 py-1.5"><input value={tDesc}    onChange={e => setTDesc(e.target.value)}    placeholder="Filter…" className={COL_INPUT} /></td>}
                  {visTote.has("contact")     && <td className="px-2 py-1.5"><input value={tContact} onChange={e => setTContact(e.target.value)} placeholder="Filter…" className={COL_INPUT} /></td>}
                  {visTote.has("category")    && <td className="px-2 py-1.5"><input value={tCategory} onChange={e => setTCategory(e.target.value)} placeholder="Filter…" className={COL_INPUT} /></td>}
                  {visTote.has("location")    && <td className="px-2 py-1.5"><input value={tLocation} onChange={e => setTLocation(e.target.value)} placeholder="Filter…" className={COL_INPUT} /></td>}
                </tr>
              </thead>
              <tbody>
                {filteredContainers.map((c, i) => (
                  <tr key={c.id} onClick={() => setEditContainer(c)} className={TR(i)}>
                    {visTote.has("id")          && <td className="px-3 py-2.5 text-gray-500 font-mono text-xs">{c.id.slice(0, 10)}…</td>}
                    {visTote.has("type")        && <td className="px-3 py-2.5 text-gray-400">{c.type}</td>}
                    {visTote.has("description") && <td className="px-3 py-2.5 text-gray-200 max-w-[200px] truncate">{c.description}</td>}
                    {visTote.has("contact")     && <td className="px-3 py-2.5 text-gray-400">{c.contactName}</td>}
                    {visTote.has("category")    && <td className="px-3 py-2.5 text-gray-400">{c.category ? `${c.category}${c.subcategory ? ` / ${c.subcategory}` : ""}` : <span className="text-gray-700">—</span>}</td>}
                    {visTote.has("location")    && <td className="px-3 py-2.5">{c.lastLocation ? <Badge color="violet">{c.lastLocation}</Badge> : <span className="text-gray-700">—</span>}</td>}
                  </tr>
                ))}
                {filteredContainers.length === 0 && <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-600 text-sm">No totes match your filters</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Lots ── */}
        {tab === "lots" && (
          <div className="overflow-x-auto rounded-b-xl rounded-tr-xl border border-gray-800 border-t-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-[#1C1C1E]">
                  {visLot.has("lotNumber") && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Lot No.</th>}
                  {visLot.has("title")     && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Title</th>}
                  {visLot.has("auction")   && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Auction</th>}
                  {visLot.has("vendor")    && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Vendor</th>}
                  {visLot.has("receipt")   && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Receipt</th>}
                  {visLot.has("tote")      && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Tote</th>}
                  {visLot.has("category")  && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Category</th>}
                  {visLot.has("condition") && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Condition</th>}
                  {visLot.has("estimate")  && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Estimate</th>}
                  {visLot.has("photos")    && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Photos</th>}
                  {visLot.has("status")    && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>}
                </tr>
                <tr className="border-b border-gray-900 bg-[#111113]">
                  {visLot.has("lotNumber") && <td className="px-2 py-1.5"><input value={lLotNo}   onChange={e => setLLotNo(e.target.value)}   placeholder="Filter…" className={COL_INPUT} /></td>}
                  {visLot.has("title")     && <td className="px-2 py-1.5"><input value={lTitle}   onChange={e => setLTitle(e.target.value)}   placeholder="Filter…" className={COL_INPUT} /></td>}
                  {visLot.has("auction")   && <td className="px-2 py-1.5"><select value={lAuction} onChange={e => setLAuction(e.target.value)} className={COL_SELECT}><option value="">All</option>{auctionCodes.map(a => <option key={a} value={a}>{a}</option>)}</select></td>}
                  {visLot.has("vendor")    && <td className="px-2 py-1.5"><input value={lVendor}  onChange={e => setLVendor(e.target.value)}  placeholder="Filter…" className={COL_INPUT} /></td>}
                  {visLot.has("receipt")   && <td className="px-2 py-1.5"><input value={lReceipt} onChange={e => setLReceipt(e.target.value)} placeholder="Filter…" className={COL_INPUT} /></td>}
                  {visLot.has("tote")      && <td className="px-2 py-1.5"><input value={lTote}    onChange={e => setLTote(e.target.value)}    placeholder="Filter…" className={COL_INPUT} /></td>}
                  {visLot.has("category")  && <td className="px-2 py-1.5"></td>}
                  {visLot.has("condition") && <td className="px-2 py-1.5"></td>}
                  {visLot.has("estimate")  && <td className="px-2 py-1.5"></td>}
                  {visLot.has("photos")    && <td className="px-2 py-1.5"></td>}
                  {visLot.has("status")    && <td className="px-2 py-1.5"><select value={lStatus} onChange={e => setLStatus(e.target.value)} className={COL_SELECT}><option value="">All</option>{lotStatuses.map(s => <option key={s} value={s}>{s}</option>)}</select></td>}
                </tr>
              </thead>
              <tbody>
                {filteredLots.map((l, i) => (
                  <tr key={l.id} onClick={() => setEditLot(l)} className={TR(i)}>
                    {visLot.has("lotNumber") && <td className="px-3 py-2.5 text-gray-300 font-mono">{l.lotNumber}</td>}
                    {visLot.has("title")     && <td className="px-3 py-2.5 text-gray-200 max-w-[180px] truncate">{l.title || <span className="text-gray-600">Untitled</span>}</td>}
                    {visLot.has("auction")   && <td className="px-3 py-2.5 text-gray-400">{l.auctionCode}</td>}
                    {visLot.has("vendor")    && <td className="px-3 py-2.5 text-gray-400">{l.vendor ?? <span className="text-gray-700">—</span>}</td>}
                    {visLot.has("receipt")   && <td className="px-3 py-2.5 text-gray-400">{l.receipt ?? <span className="text-gray-700">—</span>}</td>}
                    {visLot.has("tote")      && <td className="px-3 py-2.5 text-gray-400 font-mono">{l.tote ?? <span className="text-gray-700">—</span>}</td>}
                    {visLot.has("category")  && <td className="px-3 py-2.5 text-gray-400">{l.category ? `${l.category}${l.subCategory ? ` / ${l.subCategory}` : ""}` : <span className="text-gray-700">—</span>}</td>}
                    {visLot.has("condition") && <td className="px-3 py-2.5 text-gray-400">{l.condition ?? <span className="text-gray-700">—</span>}</td>}
                    {visLot.has("estimate")  && <td className="px-3 py-2.5 text-gray-400">{l.estimateLow || l.estimateHigh ? `£${l.estimateLow ?? "?"}–${l.estimateHigh ?? "?"}` : <span className="text-gray-700">—</span>}</td>}
                    {visLot.has("photos")    && <td className="px-3 py-2.5">{l.imageCount > 0 ? <Badge color="violet">{l.imageCount}</Badge> : <span className="text-gray-700">—</span>}</td>}
                    {visLot.has("status")    && <td className="px-3 py-2.5">{statusBadge(l.status)}</td>}
                  </tr>
                ))}
                {filteredLots.length === 0 && <tr><td colSpan={15} className="px-4 py-8 text-center text-gray-600 text-sm">No lots match your filters</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Commission Bids ── */}
        {tab === "bids" && (
          <div className="overflow-x-auto rounded-b-xl rounded-tr-xl border border-gray-800 border-t-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-[#1C1C1E]">
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Auction</th>
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Lot No.</th>
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Title</th>
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Customer</th>
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">C No.</th>
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Estimate</th>
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Max Bid</th>
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Hammer</th>
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Placed</th>
                </tr>
                <tr className="border-b border-gray-900 bg-[#111113]">
                  <td className="px-2 py-1.5">
                    <select value={bAuction} onChange={e => setBAuction(e.target.value)} className={COL_SELECT}>
                      <option value="">All</option>
                      {bidAuctionCodes.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5"></td>
                  <td className="px-2 py-1.5"></td>
                  <td className="px-2 py-1.5">
                    <input value={bCustomer} onChange={e => setBCustomer(e.target.value)} placeholder="Filter…" className={COL_INPUT} />
                  </td>
                  <td className="px-2 py-1.5">
                    <input value={bContact} onChange={e => setBContact(e.target.value)} placeholder="C000001…" className={COL_INPUT} />
                  </td>
                  <td className="px-2 py-1.5"></td>
                  <td className="px-2 py-1.5"></td>
                  <td className="px-2 py-1.5"></td>
                  <td className="px-2 py-1.5">
                    <select value={bStatus} onChange={e => setBStatus(e.target.value)} className={COL_SELECT}>
                      <option value="">All</option>
                      {bidLotStatuses.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5"></td>
                </tr>
              </thead>
              <tbody>
                {filteredBids.map((b, i) => {
                  const won = b.lotStatus === "SOLD" && b.hammerPrice !== null
                  const notWon = b.lotStatus === "SOLD" && b.hammerPrice === null
                  return (
                    <tr key={b.id} className={TR(i)}>
                      <td className="px-3 py-2.5 text-gray-400 font-mono text-xs whitespace-nowrap">{b.auctionCode}</td>
                      <td className="px-3 py-2.5 text-gray-300 font-mono text-xs whitespace-nowrap">{b.lotNumber}</td>
                      <td className="px-3 py-2.5 text-gray-200 max-w-[180px] truncate">{b.lotTitle}</td>
                      <td className="px-3 py-2.5">
                        <p className="text-gray-200 text-xs">{b.customerName}</p>
                        <p className="text-gray-600 text-[10px]">{b.customerEmail}</p>
                      </td>
                      <td className="px-3 py-2.5 text-gray-400 font-mono text-xs">{b.contactId ?? <span className="text-gray-700">—</span>}</td>
                      <td className="px-3 py-2.5 text-gray-400 text-xs whitespace-nowrap">
                        {b.estimateLow || b.estimateHigh
                          ? `£${b.estimateLow ?? "?"}–£${b.estimateHigh ?? "?"}`
                          : <span className="text-gray-700">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-violet-400 font-bold whitespace-nowrap">£{b.maxBid.toLocaleString("en-GB")}</td>
                      <td className="px-3 py-2.5 text-gray-400 text-xs whitespace-nowrap">
                        {b.hammerPrice != null
                          ? <span className={won ? "text-green-400 font-bold" : "text-gray-400"}>£{b.hammerPrice.toLocaleString("en-GB")}</span>
                          : <span className="text-gray-700">—</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        {won     ? <Badge color="green">WON</Badge>
                        : notWon ? <Badge color="red">NOT WON</Badge>
                        : statusBadge(b.lotStatus)}
                      </td>
                      <td className="px-3 py-2.5 text-gray-600 text-xs whitespace-nowrap">
                        {new Date(b.placedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })}
                      </td>
                    </tr>
                  )
                })}
                {filteredBids.length === 0 && (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-600 text-sm">No commission bids match your filters</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Browse Any Table ── */}
        {tab === "browse" && <BrowseAnyTab />}

      </div>

      {/* ── Drawers ── */}
      <Drawer title={editContact?.name ?? ""} subtitle="Edit customer" open={!!editContact} onClose={() => setEditContact(null)}>
        {editContact && (
          <ContactEditPanel row={editContact} onClose={() => setEditContact(null)}
            onSaved={updated => { setContacts(prev => prev.map(c => c.id === updated.id ? updated : c)); flash() }} />
        )}
      </Drawer>

      <Drawer title={editReceipt ? `Receipt · ${editReceipt.contactName}` : ""} subtitle="Edit receipt" open={!!editReceipt} onClose={() => setEditReceipt(null)}>
        {editReceipt && (
          <ReceiptEditPanel row={editReceipt} onClose={() => setEditReceipt(null)}
            onSaved={updated => { setReceipts(prev => prev.map(r => r.id === updated.id ? updated : r)); flash() }} />
        )}
      </Drawer>

      <Drawer title={editContainer ? `Tote · ${editContainer.id.slice(0, 8)}` : ""} subtitle={editContainer?.contactName} open={!!editContainer} onClose={() => setEditContainer(null)}>
        {editContainer && (
          <ContainerEditPanel row={editContainer} locations={locations} onClose={() => setEditContainer(null)}
            onSaved={updated => { setContainers(prev => prev.map(c => c.id === updated.id ? updated : c)); flash() }} />
        )}
      </Drawer>

      <Drawer title={editLot ? `Lot ${editLot.lotNumber}` : ""} subtitle={editLot ? `${editLot.auctionCode} — ${editLot.auctionName}` : ""} open={!!editLot} onClose={() => setEditLot(null)}>
        {editLot && (
          <LotEditPanel row={editLot} auctions={auctions} onClose={() => setEditLot(null)}
            onSaved={updated => { setLots(prev => prev.map(l => l.id === updated.id ? updated : l)); flash() }} />
        )}
      </Drawer>
    </div>
  )
}

// ─── Browse Any Table tab ────────────────────────────────────────────────────
// Generic read-only viewer for every non-sensitive Prisma model. Picks the
// table from a grouped dropdown, fetches up to 500 rows from /api/databases/browse,
// auto-discovers columns, optional case-insensitive search.

type TableMeta = { key: string; label: string; group: string; description: string }

function BrowseAnyTab() {
  const [tables,   setTables]   = useState<TableMeta[]>([])
  const [tableKey, setTableKey] = useState<string>("")
  const [search,   setSearch]   = useState("")
  const [rows,     setRows]     = useState<any[]>([])
  const [columns,  setColumns]  = useState<string[]>([])
  const [total,    setTotal]    = useState<number>(0)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [selectedRow, setSelectedRow] = useState<any | null>(null)
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load the table catalogue on mount
  useEffect(() => {
    fetch("/api/databases/browse").then(r => r.json()).then(d => {
      if (d.tables) setTables(d.tables)
    }).catch(() => setError("Failed to load table list"))
  }, [])

  // Group tables by their group field for the optgroup dropdown
  const grouped = useMemo(() => {
    const m = new Map<string, TableMeta[]>()
    for (const t of tables) {
      if (!m.has(t.group)) m.set(t.group, [])
      m.get(t.group)!.push(t)
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [tables])

  const currentMeta = tables.find(t => t.key === tableKey)

  async function load(key: string, searchTerm: string) {
    if (!key) return
    setLoading(true); setError(null)
    try {
      const params = new URLSearchParams({ table: key, limit: "500" })
      if (searchTerm.trim()) params.set("search", searchTerm.trim())
      const res = await fetch(`/api/databases/browse?${params}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Failed to load"); return }
      setRows(data.rows ?? [])
      setColumns(data.columns ?? [])
      setTotal(data.total ?? 0)
    } catch {
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }

  // Reload on table change or debounced search change
  useEffect(() => {
    if (!tableKey) return
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    searchDebounce.current = setTimeout(() => load(tableKey, search), 350)
  }, [tableKey, search])

  function formatCell(v: any): string {
    if (v === null || v === undefined) return ""
    if (typeof v === "boolean") return v ? "yes" : "no"
    if (typeof v === "string"  && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
      // ISO datetime — show as locale string
      const d = new Date(v); if (!isNaN(d.getTime())) return d.toLocaleString("en-GB")
    }
    if (Array.isArray(v)) return v.join(", ")
    return String(v)
  }

  return (
    <div className="rounded-b-xl rounded-tr-xl border border-gray-800 border-t-0 p-4 space-y-4">
      {/* Picker + search */}
      <div className="flex items-end gap-3 flex-wrap">
        <div className="min-w-[280px]">
          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Table</label>
          <select
            value={tableKey}
            onChange={e => { setTableKey(e.target.value); setSelectedRow(null) }}
            className="w-full rounded-lg border border-gray-700 bg-[#1C1C1E] px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            <option value="">— Pick a table —</option>
            {grouped.map(([group, items]) => (
              <optgroup key={group} label={group}>
                {items.map(t => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {currentMeta && <p className="text-xs text-gray-500 mt-1">{currentMeta.description}</p>}
        </div>

        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Search</label>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Case-insensitive contains across text fields"
            disabled={!tableKey}
            className="w-full rounded-lg border border-gray-700 bg-[#1C1C1E] px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-40"
          />
        </div>

        {tableKey && (
          <div className="text-xs text-gray-500 pb-2">
            {loading ? "Loading…" : (
              total > rows.length
                ? <>Showing {rows.length.toLocaleString()} of {total.toLocaleString()} (max 500)</>
                : <>{rows.length.toLocaleString()} row{rows.length === 1 ? "" : "s"}</>
            )}
          </div>
        )}
      </div>

      {error && <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300">{error}</div>}

      {!tableKey && (
        <div className="rounded-lg border border-dashed border-gray-800 p-10 text-center">
          <p className="text-sm text-gray-400">Pick a table from the dropdown to view its rows.</p>
          <p className="text-xs text-gray-600 mt-1">Read-only — the existing tabs above are where you edit data.</p>
        </div>
      )}

      {/* Table */}
      {tableKey && rows.length > 0 && (
        <div className="overflow-auto border border-gray-800 rounded-lg max-h-[70vh]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[#1C1C1E]">
              <tr>
                {columns.map(c => (
                  <th key={c} className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-gray-500 font-medium whitespace-nowrap border-b border-gray-800">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.id ?? r.uniqueId ?? i}
                  onClick={() => setSelectedRow(r)}
                  className={`border-b border-gray-800/50 hover:bg-violet-900/10 transition-colors cursor-pointer ${i % 2 === 0 ? "" : "bg-[#1C1C1E]/30"}`}
                >
                  {columns.map(c => {
                    const v = r[c]
                    const txt = formatCell(v)
                    return (
                      <td key={c} className="px-3 py-2 text-gray-300 max-w-[260px] truncate" title={txt}>
                        {txt}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tableKey && !loading && rows.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-800 p-10 text-center text-sm text-gray-500">
          No rows {search ? "match your search" : "in this table yet"}.
        </div>
      )}

      {/* Row detail drawer */}
      {selectedRow && (
        <div className="fixed inset-0 z-30 bg-black/60 flex items-end sm:items-center sm:justify-end p-4 sm:p-6" onClick={() => setSelectedRow(null)}>
          <div onClick={e => e.stopPropagation()} className="bg-[#0d0d0f] border border-gray-800 rounded-xl w-full sm:max-w-2xl max-h-[80vh] overflow-y-auto">
            <div className="sticky top-0 bg-[#0d0d0f] border-b border-gray-800 px-5 py-3 flex items-center justify-between">
              <h3 className="font-semibold text-gray-200">{currentMeta?.label} — row detail</h3>
              <button onClick={() => setSelectedRow(null)} className="text-gray-500 hover:text-gray-300 text-xl leading-none">×</button>
            </div>
            <div className="p-5 space-y-3">
              {columns.map(c => (
                <div key={c} className="grid grid-cols-3 gap-3 border-b border-gray-900 pb-2 last:border-0">
                  <span className="text-xs text-gray-500 font-medium">{c}</span>
                  <span className="col-span-2 text-xs text-gray-200 font-mono break-all whitespace-pre-wrap">
                    {formatCell(selectedRow[c]) || <span className="text-gray-700">—</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

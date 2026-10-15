import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { buildLabelsPdf, type LabelForPdf } from "@/lib/goods-in/pdf"
import { LOCATION_KINDS, normaliseCode } from "@/lib/goods-in/model"
import { customerSnapshot, errorJson, failure, flag, gate, londonDate, pdfResponse } from "../_lib/shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

// Barcode labels, one 100 × 50 mm label per page — any label printer prints a PDF page.
//
//   GET /api/goods-in/labels?receipt=R010244            every tote and pallet on a receipt
//   GET /api/goods-in/labels?containers=T027657,T027658  those totes/pallets, in that order
//   GET /api/goods-in/labels?locations=A10A1,BENCH1      location labels
//   add &download=1 to save the file instead of showing it
//
// POST takes the same fields as a form (Locations posts its ticked list this way, so a long
// selection never makes the address too long). Anyone with Warehouse access. Printing tote and
// pallet labels records labelPrintedAt on them.
//
// ⚠ A code that doesn't exist refuses the whole print and names it, rather than quietly printing
// the rest — a missing label is easy not to notice until the tote can't be found. Totes and pallets
// on a VOIDED receipt are refused the same way (409), as the receipt itself is.

const MAX_LABELS = 500

const splitCodes = (v: string | null) => {
  const out: string[] = []
  for (const part of (v ?? "").split(/[\s,;]+/)) {
    const c = normaliseCode(part)
    if (c && !out.includes(c)) out.push(c)
  }
  return out
}

const listed = (codes: string[]) => (codes.length <= 8 ? codes.join(", ") : `${codes.slice(0, 8).join(", ")} and ${codes.length - 8} more`)

const KIND_LABEL = new Map(LOCATION_KINDS.map(k => [k.value as string, k.label]))

type ContainerRow = {
  id: string; kind: string; category: string | null; description: string | null; createdAt: Date
  receipt: { id: string; status: string | null; vendorNo: string | null; customer: unknown; contact: { salutation: string | null; name: string; email: string | null; phone: string | null; addressLine1: string | null; addressLine2: string | null; postcode: string | null } }
}

const CONTAINER_SELECT = {
  id: true, kind: true, category: true, description: true, createdAt: true,
  receipt: {
    select: {
      id: true, status: true, vendorNo: true, customer: true,
      contact: { select: { salutation: true, name: true, email: true, phone: true, addressLine1: true, addressLine2: true, postcode: true } },
    },
  },
} as const

function containerLabel(c: ContainerRow): LabelForPdf {
  const cust = customerSnapshot(c.receipt.customer, c.receipt.contact, c.receipt.vendorNo)
  const what = [c.category?.trim(), c.description?.trim()].filter(Boolean).join(" – ")
  return {
    code: c.id,
    kicker: c.kind === "pallet" ? "PALLET" : "TOTE",
    lines: [cust.name, `${c.receipt.id}  ·  Booked ${londonDate(c.createdAt)}`, what].filter(Boolean),
  }
}

async function handle(p: URLSearchParams) {
  const g = await gate("warehouse")
  if (g.res) return g.res
  const download = flag(p.get("download"))

  const receipt = normaliseCode(p.get("receipt") ?? "")
  const containers = splitCodes(p.get("containers"))
  const locations = splitCodes(p.get("locations"))
  if ([receipt ? 1 : 0, containers.length ? 1 : 0, locations.length ? 1 : 0].reduce((a, b) => a + b, 0) !== 1) {
    return errorJson("Say what to print: one receipt, a list of totes and pallets, or a list of locations.", 400)
  }

  // ── Locations ──
  if (locations.length) {
    if (locations.length > MAX_LABELS) return errorJson(`That's ${locations.length.toLocaleString("en-GB")} labels — print at most ${MAX_LABELS} at a time.`, 400)
    const rows = await prisma.goodsInLocation.findMany({ where: { code: { in: locations } }, select: { code: true, name: true, kind: true } })
    const byCode = new Map(rows.map(r => [r.code, r]))
    const missing = locations.filter(c => !byCode.has(c))
    if (missing.length) return errorJson(`These aren't locations the Hub knows: ${listed(missing)}. Nothing was printed.`, 404)
    const labels: LabelForPdf[] = locations.map(code => {
      const l = byCode.get(code)!
      return { code, kicker: KIND_LABEL.get(l.kind ?? "storage") ?? "Location", lines: l.name?.trim() ? [l.name.trim()] : [] }
    })
    const bytes = await buildLabelsPdf(labels)
    return pdfResponse(bytes, labels.length === 1 ? `Location-${labels[0].code}.pdf` : `Location-labels-${labels.length}.pdf`, download)
  }

  // ── Totes and pallets ──
  let rows: ContainerRow[]
  let filename: string
  if (receipt) {
    const r = await prisma.goodsInReceipt.findUnique({ where: { id: receipt }, select: { id: true, status: true } })
    if (!r) return errorJson(`Receipt ${receipt} couldn't be found.`, 404)
    if (r.status === "void") return errorJson(`Receipt ${receipt} has been voided, so its labels can't be printed.`, 409)
    rows = await prisma.goodsInContainer.findMany({ where: { receiptId: receipt }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: CONTAINER_SELECT })
    if (rows.length === 0) return errorJson(`Receipt ${receipt} has no totes or pallets on it yet, so there are no labels to print.`, 404)
    filename = `Labels-${receipt}.pdf`
  } else {
    const found = await prisma.goodsInContainer.findMany({ where: { id: { in: containers } }, select: CONTAINER_SELECT })
    const byId = new Map(found.map(c => [c.id, c]))
    const missing = containers.filter(c => !byId.has(c))
    if (missing.length) return errorJson(`These aren't totes or pallets the Hub knows: ${listed(missing)}. Nothing was printed.`, 404)
    const onVoid = found.filter(c => c.receipt.status === "void").map(c => c.id)
    if (onVoid.length) return errorJson(`These are on a voided receipt, so their labels can't be printed: ${listed(onVoid)}. Nothing was printed.`, 409)
    rows = containers.map(c => byId.get(c)!)
    filename = rows.length === 1 ? `Label-${rows[0].id}.pdf` : `Labels-${rows.length}.pdf`
  }
  if (rows.length > MAX_LABELS) return errorJson(`That's ${rows.length.toLocaleString("en-GB")} labels — print at most ${MAX_LABELS} at a time.`, 400)

  const bytes = await buildLabelsPdf(rows.map(containerLabel))
  // Recorded once the PDF is made; a failure to record mustn't stop the labels printing.
  await prisma.goodsInContainer.updateMany({ where: { id: { in: rows.map(r => r.id) } }, data: { labelPrintedAt: new Date() } })
    .catch(e => console.error("goods-in labels: couldn't record the print:", e))
  return pdfResponse(bytes, filename, download)
}

export async function GET(req: NextRequest) {
  try {
    return await handle(req.nextUrl.searchParams)
  } catch (e) {
    return failure("labels", e)
  }
}

export async function POST(req: NextRequest) {
  try {
    const p = new URLSearchParams()
    const type = req.headers.get("content-type") ?? ""
    if (type.includes("application/json")) {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
      for (const [k, v] of Object.entries(body ?? {})) {
        if (typeof v === "string") p.set(k, v)
        else if (Array.isArray(v)) p.set(k, v.filter(x => typeof x === "string").join(","))
        else if (typeof v === "boolean" || typeof v === "number") p.set(k, String(v))
      }
    } else {
      const form = await req.formData()
      for (const [k, v] of form.entries()) if (typeof v === "string") p.append(k, v)
      // A form can send one field per ticked box (locations=A1&locations=A2) — join them.
      for (const k of ["containers", "locations"]) if (p.getAll(k).length > 1) p.set(k, p.getAll(k).join(","))
    }
    return await handle(p)
  } catch (e) {
    return failure("labels", e)
  }
}

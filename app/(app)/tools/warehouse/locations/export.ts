import type { GoodsHere } from "@/lib/actions/goods-in-locations"
import { CONTAINER_STATUS, type ContainerStatus } from "@/lib/goods-in/model"
import { csvCell, type LocationArea } from "@/lib/goods-in/location-codes"
import { ukDate, ukDateTime } from "../_components/ui"
import { KIND } from "./chips"
import type { Row } from "./filters"

// Goods In → Locations: spreadsheets, made in the browser — the list of locations, and what is
// at some locations now. Every cell goes through csvCell (a name starting = + - @ can't run as a
// formula), with a byte-order mark so Excel reads £ and accents properly, and Windows line
// endings. Dates are UK, London time. Paste a list reads the locations file back.

const AREA: Record<LocationArea, string> = { aisle: "Aisle", bench: "Bench", cabinet: "Cabinet", named: "Named area" }

const HEAD = ["Code", "Name", "Kind", "In use", "Area", "Aisle", "Bay", "Shelf", "Totes & pallets here", "Lots here", "Last used", "Added"]

export const lastUsedWords = (r: Pick<Row, "lastUsedAt" | "everUsed">) =>
  r.lastUsedAt ? ukDate(r.lastUsedAt) : r.everUsed ? "No date recorded" : "Never"

const toCsv = (lines: unknown[][]) => "﻿" + lines.map(cells => cells.map(csvCell).join(",")).join("\r\n") + "\r\n"

export function locationsCsv(rows: Row[]): string {
  return toCsv([HEAD, ...rows.map(r => [
    r.code, r.name ?? "", KIND[r.kind].label, r.active ? "Yes" : "No", AREA[r.parts.area],
    r.parts.aisle ?? "", r.parts.bay ?? "", r.parts.shelf ?? "", r.totes, r.lots, lastUsedWords(r), ukDate(r.createdAt),
  ])])
}

const LOT_STATUS: Record<string, string> = { ENTERED: "Entered", REVIEWED: "Reviewed", PUBLISHED: "Published", SOLD: "Sold", UNSOLD: "Unsold", WITHDRAWN: "Withdrawn" }
const statusWords = (g: GoodsHere) =>
  g.type === "lot"
    ? (g.status ? LOT_STATUS[g.status] ?? g.status : "")
    : CONTAINER_STATUS[(g.status && g.status in CONTAINER_STATUS ? g.status : "booked") as ContainerStatus].label
const TYPE = { tote: "Tote", pallet: "Pallet", lot: "Lot" } as const

/** What is at some locations now — one line per tote, pallet and lot. */
export function goodsHereCsv(rows: GoodsHere[]): string {
  return toCsv([
    ["Location", "Type", "Tote, pallet or barcode", "Status", "Receipt", "Customer", "What", "Sale", "Here since", "Put here by"],
    ...rows.map(g => [g.location, TYPE[g.type], g.code, statusWords(g), g.receipt ?? "", g.customer ?? "", g.what ?? "", g.sale ?? "", g.since ? ukDateTime(g.since) : "", g.by ?? ""]),
  ])
}

/** Today's date in London as YYYY-MM-DD, for the file name. */
function londonDate(): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date())
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ""
  return `${get("year")}-${get("month")}-${get("day")}`
}

/** Save text as a CSV file in the browser (a Blob — nothing goes to the server). */
function download(csv: string, name: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Save these locations as goods-in-locations-YYYY-MM-DD.csv. */
export function downloadLocationsCsv(rows: Row[]) {
  download(locationsCsv(rows), `goods-in-locations-${londonDate()}.csv`)
}

/** Save what is at some locations as goods-in-whats-at-{CODE or N-locations}-YYYY-MM-DD.csv. */
export function downloadGoodsHereCsv(rows: GoodsHere[], codes: string[]) {
  const which = codes.length === 1 ? codes[0].replace(/[^A-Za-z0-9-]/g, "-") : `${codes.length}-locations`
  download(goodsHereCsv(rows), `goods-in-whats-at-${which}-${londonDate()}.csv`)
}

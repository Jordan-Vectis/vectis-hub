import { NextRequest, NextResponse } from "next/server"
import { readNudge, readRun, runProblem, barcodeOf } from "@/lib/barcode-labels"
import { buildBarcodeLabelsPdf } from "@/lib/barcode-labels-pdf"
import { logLabelRun, requireBarcodes } from "@/lib/barcode-labels-server"
import { fromThisHub } from "@/lib/goods-in/scanner-pass"
import { pdfResponse } from "@/app/api/goods-in/_lib/shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/barcodes/labels   (form: sale, date, from, count, startAt, edges, right, down) → the labels' PDF, inline
//
// Admin & Operations → Barcode Labels: a sale's Lot ID labels (X160001 …) as one A4 PDF for Avery
// L7651 sheets, laid out exactly like the old Word mail merge (lib/barcode-labels-pdf.ts). The page
// posts a form into a new tab, so a refusal is answered as plain text that tab shows. `right` / `down`
// (mm) move the whole print for a printer that's off — the page's own setting, never stored here. Each PDF made is
// logged (BarcodeLabelRun — best effort, never in the way of the labels); a test print ("edges") isn't.
// /api is outside the login gate, so the check is here (requireBarcodes — the BARCODES app), and only
// this Hub's own pages may ask (fromThisHub). Nothing here touches Business Central.

const plain = (text: string, status: number) =>
  new NextResponse(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } })

export async function POST(req: NextRequest) {
  if (!fromThisHub(req.headers)) return plain("That request didn't come from the Hub's Barcode Labels page.", 403)
  let who: { userId: string; name: string }
  try {
    who = await requireBarcodes()
  } catch (e) {
    const err = e as { http?: number; message?: string }
    return plain(err.message ?? "You can't print barcode labels.", err.http ?? 403)
  }

  const form = await req.formData().catch(() => null)
  if (!form) return plain("The labels couldn't be read — go back and press Print again.", 400)
  const fields: Record<string, unknown> = {}
  for (const k of ["sale", "date", "from", "count", "startAt"]) fields[k] = form.get(k)
  const run = readRun(fields)
  const problem = runProblem(run)
  if (problem) return plain(`${problem} Nothing was printed.`, 400)
  const edges = form.get("edges") === "1"
  const nudge = readNudge({ right: form.get("right"), down: form.get("down") })
  if (!nudge) return plain("The print's position isn't right — go back, press Centre under the preview, and print again. Nothing was printed.", 400)

  try {
    const bytes = await buildBarcodeLabelsPdf(run, { edges, nudge })
    if (!edges) await logLabelRun(run, who)
    const last = barcodeOf(run.sale, run.from + run.count - 1)
    return pdfResponse(bytes, `${edges ? "Test " : ""}Labels ${barcodeOf(run.sale, run.from)}${run.count > 1 ? `-${last}` : ""}.pdf`, false)
  } catch (e) {
    console.error("barcode labels pdf error:", e)
    return plain("The labels couldn't be made just now — please try again.", 500)
  }
}

import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { buildReceiptPdf } from "@/lib/goods-in/pdf"
import { errorJson, failure, flag, gate, loadReceiptForPdf, pdfResponse } from "../../../_lib/shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

// GET /api/goods-in/receipt/R010244/pdf            → the receipt, shown in the browser
//                                      ?download=1  → saved as a file instead
//                                      ?print=1     → also records that it was printed (shown on the receipt page)
// Anyone with Warehouse access. The customer's details come from the snapshot taken at booking.
// A voided receipt is refused (409), the same as the email route — and so is a check-in that hasn't
// been booked in yet (a draft): it has its number, but no receipt exists until Book in is pressed.
// (Its labels can still be printed — the labels route allows a draft.)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await gate("warehouse")
    if (g.res) return g.res

    const { id } = await params
    const r = await loadReceiptForPdf(id)
    if (!r) return errorJson(`Receipt ${id.toUpperCase()} couldn't be found.`, 404)
    // As the email route: a voided receipt must never go out looking like a live one.
    if (r.status === "void") return errorJson(`Receipt ${r.pdf.id} has been voided, so it can't be printed.`, 409)
    if (r.status === "draft") return errorJson(`${r.pdf.id} hasn't been booked in yet — finish the check-in first.`, 409)

    const bytes = await buildReceiptPdf(r.pdf)

    if (flag(req.nextUrl.searchParams.get("print"))) {
      // The same record markReceiptSent({ printed: true }) makes. A failure here mustn't stop the receipt printing.
      await prisma.goodsInReceipt.update({ where: { id: r.pdf.id }, data: { printedAt: new Date() } })
        .catch(e => console.error("goods-in receipt pdf: couldn't record the print:", e))
    }

    return pdfResponse(bytes, `Receipt-${r.pdf.id}.pdf`, flag(req.nextUrl.searchParams.get("download")))
  } catch (e) {
    return failure("receipt pdf", e)
  }
}

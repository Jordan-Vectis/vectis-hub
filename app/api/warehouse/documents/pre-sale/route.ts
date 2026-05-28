import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireWarehouseAccess } from "@/lib/warehouse-auth"

const COMPANY = {
  name: "Vectis Auctions",
  address: "Fleck Way, Thornaby, Stockton-on-Tees, TS17 9JZ",
  tel: "01642 750616",
  email: "admin@vectis.co.uk",
  web: "www.vectis.co.uk",
}

export async function GET(req: NextRequest) {
  try {
    await requireWarehouseAccess("warehouse")
    const customerId = req.nextUrl.searchParams.get("customerId")
    const auctionId = req.nextUrl.searchParams.get("auctionId")
    if (!customerId || !auctionId) return NextResponse.json({ error: "customerId and auctionId required" }, { status: 400 })

    const [contact, auction, receipts] = await Promise.all([
      prisma.contact.findUnique({ where: { id: customerId } }),
      prisma.catalogueAuction.findUnique({ where: { id: auctionId } }),
      prisma.warehouseReceipt.findMany({ where: { contactId: customerId }, select: { id: true } }),
    ])

    if (!contact || !auction) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const lots = await prisma.catalogueLot.findMany({
      where: {
        auctionId,
        OR: receipts.map(r => ({ receipt: { startsWith: r.id + "-" } })),
      },
      orderBy: { createdAt: "asc" },
    })

    const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })
    const auctionDate = auction.auctionDate
      ? auction.auctionDate.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })
      : "To be confirmed"

    const fmtMoney = (n: number | null | undefined) => n != null ? `£${n.toLocaleString("en-GB")}` : "—"
    const fmtEst = (lo: number | null | undefined, hi: number | null | undefined) => {
      if (lo && hi) return `${fmtMoney(lo)} – ${fmtMoney(hi)}`
      if (lo) return `${fmtMoney(lo)}+`
      return "—"
    }

    const lotRows = lots.map(lot => `
      <tr>
        <td style="font-size:8pt">${esc(lot.barcode ?? lot.receiptUniqueId ?? "")}</td>
        <td>${esc(lot.title)}</td>
        <td style="font-size:8pt;color:#555">${esc(lot.receipt ?? "")}</td>
        <td>${fmtMoney(lot.reserve)}</td>
        <td>${fmtEst(lot.estimateLow, lot.estimateHigh)}</td>
      </tr>`).join("")

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Pre-Sale Advice – ${esc(contact.name)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 10pt; color: #000; padding: 20mm; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; border-bottom: 2px solid #000; padding-bottom: 10px; }
  .company-name { font-size: 18pt; font-weight: bold; letter-spacing: 1px; }
  .company-details { font-size: 8pt; color: #444; margin-top: 2px; }
  .doc-title { font-size: 14pt; font-weight: bold; text-align: right; }
  .doc-ref { font-size: 9pt; text-align: right; color: #444; margin-top: 4px; }
  .letter { font-size: 10pt; line-height: 1.6; margin-bottom: 16px; }
  .letter .to { margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th { background: #222; color: #fff; font-size: 8.5pt; padding: 5px 6px; text-align: left; }
  td { font-size: 9pt; padding: 4px 6px; border-bottom: 1px solid #ddd; }
  tr:nth-child(even) td { background: #f9f9f9; }
  .totals-row td { font-weight: bold; background: #f0f0f0 !important; border-top: 2px solid #999; }
  .footer-note { font-size: 8.5pt; color: #444; border-top: 1px solid #ccc; padding-top: 8px; margin-top: 10px; }
  @media print { body { padding: 10mm 15mm; } }
</style>
</head>
<body onload="window.print()">

<div class="header">
  <div>
    <div class="company-name">${COMPANY.name.toUpperCase()}</div>
    <div class="company-details">${COMPANY.address}</div>
    <div class="company-details">Tel: ${COMPANY.tel} &nbsp;|&nbsp; ${COMPANY.email} &nbsp;|&nbsp; ${COMPANY.web}</div>
  </div>
  <div>
    <div class="doc-title">PRE-SALE ADVICE</div>
    <div class="doc-ref">Date: <strong>${today}</strong></div>
    <div class="doc-ref">Vendor No: <strong>${esc(contact.id)}</strong></div>
  </div>
</div>

<div class="letter">
  <div class="to">
    <strong>${esc(contact.salutation ? contact.salutation + " " + contact.name : contact.name)}</strong><br>
    ${contact.addressLine1 ? esc(contact.addressLine1) + "<br>" : ""}
    ${contact.addressLine2 ? esc(contact.addressLine2) + "<br>" : ""}
    ${contact.postcode ? esc(contact.postcode) + "<br>" : ""}
  </div>
  <p>Dear ${esc(contact.salutation ? contact.salutation + " " + contact.name.split(" ").pop() : contact.name)},</p>
  <br>
  <p>Please find below details of your items included in the <strong>${esc(auction.name)}</strong> (${esc(auction.code)}) auction scheduled for <strong>${auctionDate}</strong>.</p>
  <br>
  <p>Please check all details carefully and advise us immediately if any information is incorrect. Lots will be listed on our website in due course.</p>
</div>

<table>
  <thead>
    <tr>
      <th style="width:100px">Barcode / Unique ID</th>
      <th>Description</th>
      <th style="width:90px">Receipt</th>
      <th style="width:80px">Reserve</th>
      <th style="width:120px">Estimate</th>
    </tr>
  </thead>
  <tbody>
    ${lotRows || '<tr><td colspan="5" style="text-align:center;color:#999;padding:16px">No lots found for this auction</td></tr>'}
  </tbody>
  ${lots.length > 0 ? `<tfoot><tr class="totals-row">
    <td colspan="4">Total Lots: ${lots.length}</td>
    <td></td>
  </tr></tfoot>` : ""}
</table>

<div class="footer-note">
  If you have any queries regarding this advice, please contact us on ${COMPANY.tel} or email ${COMPANY.email}.<br>
  Thank you for consigning with ${COMPANY.name}.
</div>

</body>
</html>`

    return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 })
  }
}

function esc(s: string | null | undefined): string {
  if (!s) return ""
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

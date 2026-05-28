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

const VAT_RATE = 0.20

export async function GET(req: NextRequest) {
  try {
    await requireWarehouseAccess("warehouse")
    const customerId = req.nextUrl.searchParams.get("customerId")
    const auctionId = req.nextUrl.searchParams.get("auctionId")
    if (!customerId || !auctionId) return NextResponse.json({ error: "customerId and auctionId required" }, { status: 400 })

    const [contact, auction, receipts] = await Promise.all([
      prisma.contact.findUnique({ where: { id: customerId } }),
      prisma.catalogueAuction.findUnique({ where: { id: auctionId } }),
      prisma.warehouseReceipt.findMany({ where: { contactId: customerId } }),
    ])

    if (!contact || !auction) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // Build map: receiptId → commissionRate
    const commissionMap = Object.fromEntries(receipts.map(r => [r.id, r.commissionRate]))

    const lots = await prisma.catalogueLot.findMany({
      where: {
        auctionId,
        OR: receipts.map(r => ({ receipt: { startsWith: r.id + "-" } })),
        hammerPrice: { not: null },
      },
      orderBy: { createdAt: "asc" },
    })

    const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })
    const auctionDate = auction.auctionDate
      ? auction.auctionDate.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })
      : "—"

    const fmtMoney = (n: number) => `£${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`

    // Calculate totals
    let totalHammer = 0
    let totalCommission = 0

    const lotsWithCalcs = lots.map(lot => {
      const hammer = lot.hammerPrice ?? 0
      const receiptPrefix = lot.receipt ? lot.receipt.replace(/-\d+$/, "") : null
      const commRate = receiptPrefix ? (commissionMap[receiptPrefix] ?? 0) : 0
      const commission = hammer * (commRate / 100)
      const commVat = commission * VAT_RATE
      const commTotal = commission + commVat
      const subTotal = hammer - commTotal
      totalHammer += hammer
      totalCommission += commTotal
      return { lot, hammer, commRate, commission, commVat, commTotal, subTotal }
    })

    const totalRemittance = totalHammer - totalCommission

    const lotRows = lotsWithCalcs.map(({ lot, hammer, commRate, commTotal, subTotal }) => `
      <tr>
        <td style="font-size:8pt;color:#555">${esc(lot.barcode ?? lot.receiptUniqueId ?? "")}</td>
        <td style="font-size:8pt;color:#555">${esc(lot.receipt ?? "")}</td>
        <td>${esc(lot.title)}</td>
        <td style="text-align:right">${fmtMoney(hammer)}</td>
        <td style="text-align:right;color:#555;font-size:8.5pt">${commRate}% + VAT<br>${fmtMoney(commTotal)}</td>
        <td style="text-align:right">${fmtMoney(subTotal)}</td>
      </tr>`).join("")

    // Statement number: vendorId + auction code
    const statementNo = `${contact.id}-${auction.code}`

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Vendor Statement – ${esc(contact.name)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 10pt; color: #000; padding: 20mm; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; border-bottom: 2px solid #000; padding-bottom: 10px; }
  .company-name { font-size: 18pt; font-weight: bold; letter-spacing: 1px; }
  .company-details { font-size: 8pt; color: #444; margin-top: 2px; }
  .doc-title { font-size: 14pt; font-weight: bold; text-align: right; }
  .doc-ref { font-size: 9pt; text-align: right; color: #444; margin-top: 4px; }
  .meta-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px 16px; margin-bottom: 16px; padding: 10px; background: #f9f9f9; border: 1px solid #ddd; }
  .meta-field label { font-size: 7.5pt; color: #555; display: block; text-transform: uppercase; }
  .meta-field span { font-size: 9pt; font-weight: bold; }
  .vendor-address { margin-bottom: 14px; font-size: 9.5pt; line-height: 1.6; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th { background: #222; color: #fff; font-size: 8.5pt; padding: 5px 6px; text-align: left; }
  td { font-size: 9pt; padding: 4px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
  tr:nth-child(even) td { background: #f9f9f9; }
  .totals-table { width: 280px; margin-left: auto; border-collapse: collapse; }
  .totals-table td { padding: 4px 8px; font-size: 9.5pt; border-bottom: 1px solid #e0e0e0; }
  .totals-table .total-row td { font-size: 11pt; font-weight: bold; border-top: 2px solid #000; border-bottom: 2px solid #000; }
  .totals-table .label-col { color: #444; }
  .totals-table .value-col { text-align: right; font-weight: bold; }
  .footer-note { font-size: 8.5pt; color: #444; border-top: 1px solid #ccc; padding-top: 8px; margin-top: 14px; }
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
    <div class="doc-title">VENDOR STATEMENT</div>
    <div class="doc-ref">Statement No: <strong>${esc(statementNo)}</strong></div>
    <div class="doc-ref">Date: <strong>${today}</strong></div>
  </div>
</div>

<div class="meta-grid">
  <div class="meta-field"><label>Vendor No.</label><span>${esc(contact.id)}</span></div>
  <div class="meta-field"><label>Vendor Name</label><span>${esc(contact.name)}</span></div>
  <div class="meta-field"><label>Auction Code</label><span>${esc(auction.code)}</span></div>
  <div class="meta-field"><label>Sale Date</label><span>${auctionDate}</span></div>
</div>

<table>
  <thead>
    <tr>
      <th style="width:100px">Barcode / Unique ID</th>
      <th style="width:85px">Receipt</th>
      <th>Description</th>
      <th style="width:90px;text-align:right">Hammer Price</th>
      <th style="width:110px;text-align:right">Commission</th>
      <th style="width:90px;text-align:right">Sub Total</th>
    </tr>
  </thead>
  <tbody>
    ${lotRows || '<tr><td colspan="6" style="text-align:center;color:#999;padding:16px">No sold lots found for this auction</td></tr>'}
  </tbody>
</table>

<table class="totals-table">
  <tbody>
    <tr>
      <td class="label-col">Total Hammer Price</td>
      <td class="value-col">${fmtMoney(totalHammer)}</td>
    </tr>
    <tr>
      <td class="label-col">Less Commission + VAT</td>
      <td class="value-col" style="color:#c00">– ${fmtMoney(totalCommission)}</td>
    </tr>
    <tr class="total-row">
      <td class="label-col">Total Remittance</td>
      <td class="value-col">${fmtMoney(totalRemittance)}</td>
    </tr>
    <tr>
      <td class="label-col">Payment Method</td>
      <td class="value-col" style="font-weight:normal">BACS</td>
    </tr>
    <tr>
      <td class="label-col" style="font-size:8.5pt;color:#888" colspan="2">Payment due within 25 working days of sale date</td>
    </tr>
  </tbody>
</table>

<div class="footer-note">
  Commission is subject to VAT at ${VAT_RATE * 100}%. Vectis Auctions is VAT registered.<br>
  If you have any queries regarding this statement, please contact us on ${COMPANY.tel} or email ${COMPANY.email}.
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

import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getSignedImageUrl } from "@/lib/r2"

export const maxDuration = 120

// GET /api/accounts/transfer/export — download EVERYTHING in the Accounts
// section as one JSON file, for moving between environments (staging ⇄
// production have separate databases). Mirrors the Auction AI instructions
// export/import pattern. Admin only.
//
// The file carries the rows (with their original ids, so statement→line
// matches survive) plus a 24-hour signed download URL for every scan /
// statement image. The import on the other environment copies any file its
// own R2 bucket doesn't already have — so this works whether or not the two
// environments share a bucket. ⚠ Import within 24 hours of exporting, or the
// file links expire (the data rows still import; re-export for the files).

const URL_EXPIRY = 86_400 // 24h

export async function GET() {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const [cardholders, supplierRules, months, documents, statements, transactions] = await Promise.all([
      prisma.accountingCardholder.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.accountingSupplierRule.findMany(),
      prisma.accountingMonth.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.accountingDocument.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.bankStatement.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.bankTransaction.findMany({ orderBy: { createdAt: "asc" } }),
    ])

    // Every R2 key referenced anywhere, each with a signed URL the importing
    // environment can fetch it from.
    const keys = new Set<string>()
    for (const d of documents) {
      for (const k of d.images ?? []) keys.add(k)
      if (d.imageKey) keys.add(d.imageKey)
    }
    for (const s of statements) for (const k of s.images ?? []) keys.add(k)

    const files: { key: string; url: string }[] = []
    for (const key of keys) {
      files.push({ key, url: await getSignedImageUrl(key, URL_EXPIRY) })
    }

    const payload = {
      kind: "vectis-accounts-transfer",
      version: 1,
      exportedAt: new Date().toISOString(),
      counts: {
        cardholders: cardholders.length,
        supplierRules: supplierRules.length,
        months: months.length,
        documents: documents.length,
        statements: statements.length,
        transactions: transactions.length,
        files: files.length,
      },
      cardholders,
      supplierRules,
      months,
      documents,
      statements,
      transactions,
      files,
    }

    const body = JSON.stringify(payload)
    const filename = `vectis-accounts-${new Date().toISOString().slice(0, 10)}.json`
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type":        "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    })
  } catch (e: any) {
    console.error("accounts/transfer/export error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { getEffectiveSession } from "@/lib/impersonation"
import { atLeast, getGoodsInUser } from "@/lib/goods-in/access"
import {
  CARDS_NO_SECRET, CARDS_NOT_SET_UP, fromThisHub, isMissingTable, newCardCode, scannerCardsConfigured, warehouseTierOf,
} from "@/lib/goods-in/scanner-pass"
import { buildScannerCardPdf } from "@/lib/goods-in/scanner-card-pdf"
import { errorJson, pdfResponse } from "../_lib/shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/goods-in/scanner-cards   (form or JSON: { userId?, label? }) → the new card's PDF
//
// Makes a scanner sign-in card (lib/goods-in/scanner-pass.ts has the rules) and answers its PDF,
// inline — ⚠ the ONLY time the card's code exists outside the scanner: the Hub keeps its SHA-256
// alone, so the code is never stored, logged or answered anywhere else. Any Goods In user may make
// one for themselves; a Warehouse manager or admin may make one for anyone with Warehouse access at
// or below their own tier (a manager can't make an admin's). Old cards stay valid until they're
// cancelled (Goods In → Scanner cards).
//
// ⚠ The Hub session ONLY (getGoodsInUser — fresh from the database, effective session): a scanner
// card session never makes cards, and nor does an admin while VIEWING AS someone (the card would be
// that person's sign-in, recorded as made by them). /api is outside the login gate, so the check is
// here, and only this Hub's own pages may ask (fromThisHub). The page posts a form into a new tab,
// which gets its errors as plain text; a JSON call gets { error }. Nothing here touches Business
// Central.

const MAX_LABEL = 60

const one = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F]/g, " ").trim() : "")

/** "Production", "Staging", "Sandbox"… — which Hub the card works on (it works on no other). */
function hubName(): string {
  const env = (process.env.RAILWAY_ENVIRONMENT_NAME || "").trim()
  if (env) return env.charAt(0).toUpperCase() + env.slice(1)
  return process.env.NODE_ENV === "production" ? "Vectis" : "Development"
}

export async function POST(req: NextRequest) {
  const type = req.headers.get("content-type") ?? ""
  const isForm = /application\/x-www-form-urlencoded|multipart\/form-data/i.test(type)
  const refuse = (error: string, status: number) =>
    isForm
      ? new NextResponse(error, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } })
      : errorJson(error, status)
  try {
    if (!fromThisHub(req.headers)) return refuse("That request didn't come from the Hub's Scanner cards page.", 403)

    const session = await getEffectiveSession()
    const me = session ? await getGoodsInUser() : null
    if (!me) {
      return session
        ? refuse("Your account doesn't have Warehouse access.", 403)
        : refuse("You're not signed in — sign in to the Hub and try again.", 401)
    }
    // ⚠ Never while an admin is viewing as someone: the card would sign in as THEM, and the record
    // would say they made it themselves. The admin stops viewing as them and prints it as themselves.
    if (session?.isImpersonating) {
      return refuse(`You're viewing the Hub as ${session.user.name || "someone else"} — stop viewing as them first. A scanner card is a sign-in, so it can only be made as yourself (a manager or admin can then print one for them).`, 403)
    }
    if (!scannerCardsConfigured()) return refuse(CARDS_NO_SECRET, 503)

    let body: Record<string, unknown> = {}
    if (isForm) {
      const form = await req.formData().catch(() => null)
      if (form) body = { userId: form.get("userId"), label: form.get("label") }
    } else {
      const json = (await req.json().catch(() => null)) as unknown
      if (json && typeof json === "object" && !Array.isArray(json)) body = json as Record<string, unknown>
    }
    const userId = one(body.userId) || me.id
    const label = one(body.label).slice(0, MAX_LABEL) || null

    let target: { id: string; name: string }
    if (userId === me.id) {
      target = { id: me.id, name: me.name ?? "" }
    } else {
      if (!atLeast(me, "manager")) return refuse("Only a Warehouse manager or admin can print a card for someone else.", 403)
      if (userId.length > 64) return refuse("That person isn't in the Hub.", 400)
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true, allowedApps: true, appPermissions: true } })
      if (!u) return refuse("That person isn't in the Hub.", 400)
      const tier = warehouseTierOf(u)
      if (!tier) return refuse(`${u.name} doesn't have Warehouse access, so a scanner card wouldn't sign them in.`, 400)
      // A card signs in AS its person, so nobody makes one for someone above their own Warehouse tier.
      if (!atLeast(me, tier)) return refuse(`Only a Warehouse admin can print a card for ${u.name} (a Warehouse ${tier}).`, 403)
      target = { id: u.id, name: u.name }
    }

    // The PDF first: if it can't be made, no card exists that nobody holds.
    const { code, hash } = newCardCode()
    const createdAt = new Date()
    const pdf = await buildScannerCardPdf({ name: target.name, code, hubName: hubName(), createdAt })
    try {
      await prisma.goodsInScannerPass.create({
        data: {
          id: randomUUID(), userId: target.id, userName: target.name || null, tokenHash: hash, label,
          createdAt, createdById: me.id, createdByName: me.name,
        },
      })
    } catch (e) {
      if (isMissingTable(e)) return refuse(CARDS_NOT_SET_UP, 503)
      throw e
    }
    revalidatePath("/tools/warehouse/scanner-cards")
    return pdfResponse(pdf, `scanner-card-${target.name || "card"}.pdf`, false)
  } catch (e) {
    // Never the error itself in the log beyond its message — and the code is never in it.
    console.error("goods-in scanner card error:", (e as Error)?.message ?? e)
    if (isMissingTable(e)) return refuse(CARDS_NOT_SET_UP, 503)
    return refuse("The card couldn't be made — please try again.", 500)
  }
}

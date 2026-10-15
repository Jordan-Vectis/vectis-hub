import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getEffectiveSession } from "@/lib/impersonation"
import { GoodsInAccessError, requireGoodsIn, type GoodsInUser } from "@/lib/goods-in/access"
import type { WarehouseRole } from "@/lib/apps"
import { DEFAULT_TERMS, normaliseCode, type CustomerSnapshot } from "@/lib/goods-in/model"
import { MailNotReadyError } from "@/lib/goods-in/mail"
import type { ReceiptForPdf } from "@/lib/goods-in/pdf"

// Shared by the Goods In API routes. SERVER ONLY. (A private `_lib` folder, so it is never a route.)
//
// ⚠ proxy.ts leaves every /api route out of the login gate, so EVERY Goods In route checks the
// person itself, through gate() — fresh from the database, on the effective session.

/** The httpOnly cookie that carries the mailbox sign-in's `state` from connect to callback. */
export const MAIL_STATE_COOKIE = "gi_mail_state"
export const MAIL_STATE_PATH = "/api/goods-in/mail"

export type Gate ={ me: GoodsInUser; res?: undefined } | { me?: undefined; res: NextResponse }

/** The signed-in person with at least `minRole` Warehouse access, or the response that refuses them. */
export async function gate(minRole: WarehouseRole = "warehouse"): Promise<Gate> {
  const session = await getEffectiveSession()
  if (!session) return { res: NextResponse.json({ ok: false, error: "You're not signed in — sign in to the Hub and try again." }, { status: 401 }) }
  try {
    return { me: await requireGoodsIn(minRole) }
  } catch (e) {
    if (e instanceof GoodsInAccessError) return { res: NextResponse.json({ ok: false, error: e.message }, { status: 403 }) }
    throw e
  }
}

/** True when the Goods In tables (or a column) aren't on this environment yet. */
export const isMissingTable = (e: unknown) =>
  /does not exist|P2021|P2022/i.test(`${(e as { message?: string })?.message ?? ""} ${(e as { code?: string })?.code ?? ""}`)

/** The catch-all every route ends with: a plain `{ error }` JSON answer, never an HTML error page. */
export function failure(where: string, e: unknown): NextResponse {
  if (isMissingTable(e)) {
    return NextResponse.json({ ok: false, error: "Goods In isn't set up on this environment yet — an admin needs to press Run Migrations." }, { status: 503 })
  }
  if (e instanceof MailNotReadyError) return NextResponse.json({ ok: false, error: e.message }, { status: 502 })
  console.error(`goods-in ${where} error:`, e)
  const msg = String((e as { message?: string })?.message ?? e)
  return NextResponse.json({ ok: false, error: msg && msg.length < 200 ? msg : "Something went wrong — please try again." }, { status: 500 })
}

export const errorJson = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status })

/** A PDF answer: shown in the browser, or saved when `download` is set. Never cached — it holds a customer's details. */
export function pdfResponse(bytes: Uint8Array, filename: string, download: boolean): NextResponse {
  const name = filename.replace(/[^A-Za-z0-9._-]+/g, "-")
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

/** "1", "true", "yes" — how a query flag is switched on. */
export const flag = (v: string | null | undefined) => !!v && /^(1|true|yes|on)$/i.test(v.trim())

const str = (o: Record<string, unknown>, k: string) => (typeof o[k] === "string" && (o[k] as string).trim() ? (o[k] as string).trim() : null)

/**
 * The customer as printed on the receipt: the snapshot taken at booking, exactly as it was (a
 * reprint next year says what it said on the day). Only a receipt with no snapshot at all falls
 * back to the customer record as it is now.
 */
export function customerSnapshot(
  json: unknown,
  fallback: { salutation: string | null; name: string; email: string | null; phone: string | null; addressLine1: string | null; addressLine2: string | null; postcode: string | null } | null,
  vendorNo: string | null,
): CustomerSnapshot {
  const o = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : null
  if (o && str(o, "name")) {
    return {
      salutation: str(o, "salutation"), name: str(o, "name")!, addressLine1: str(o, "addressLine1"), addressLine2: str(o, "addressLine2"),
      town: str(o, "town"), county: str(o, "county"), postcode: str(o, "postcode"), country: str(o, "country"), email: str(o, "email"),
      mobile: str(o, "mobile"), phone: str(o, "phone"), vatRegNo: str(o, "vatRegNo"), vendorNo: str(o, "vendorNo") ?? vendorNo,
    }
  }
  return {
    salutation: fallback?.salutation ?? null, name: fallback?.name ?? "", addressLine1: fallback?.addressLine1 ?? null, addressLine2: fallback?.addressLine2 ?? null,
    town: null, county: null, postcode: fallback?.postcode ?? null, country: null, email: fallback?.email ?? null, mobile: null,
    phone: fallback?.phone ?? null, vatRegNo: null, vendorNo,
  }
}

export type LoadedReceipt = { pdf: ReceiptForPdf; status: string | null; email: string | null }

/** A receipt in the shape the PDF wants: its totes and pallets in the order they were booked, terms with the usual defaults. */
export async function loadReceiptForPdf(rawId: string): Promise<LoadedReceipt | null> {
  const id = normaliseCode(rawId)
  if (!id) return null
  const r = await prisma.goodsInReceipt.findUnique({
    where: { id },
    include: {
      containers: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, kind: true, category: true, description: true } },
      contact: { select: { salutation: true, name: true, email: true, phone: true, addressLine1: true, addressLine2: true, postcode: true } },
    },
  })
  if (!r) return null
  const customer = customerSnapshot(r.customer, r.contact, r.vendorNo)
  const num = (v: number | null | undefined, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d)
  return {
    status: r.status,
    email: customer.email,
    pdf: {
      id: r.id,
      createdAt: r.createdAt,
      customer,
      commission: num(r.commission, DEFAULT_TERMS.commission),
      lottingFee: num(r.lottingFee, DEFAULT_TERMS.lottingFee),
      photographyFee: num(r.photographyFee, DEFAULT_TERMS.photographyFee),
      unsoldFee: num(r.unsoldFee, DEFAULT_TERMS.unsoldFee),
      reservePercent: num(r.reservePercent, DEFAULT_TERMS.reservePercent),
      ownerConfirmed: !!r.ownerConfirmed,
      agentConfirmed: !!r.agentConfirmed,
      createdByName: r.createdByName,
      containers: r.containers,
    },
  }
}

/** London date in British order, e.g. "15 Oct 2026". */
export const londonDate = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" }).format(d)

export const londonLongDate = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric" }).format(d)

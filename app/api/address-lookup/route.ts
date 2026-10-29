import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"

// Postcode → every address on it, from Ideal Postcodes (Royal Mail PAF). One credit per postcode
// found; a postcode it can't find costs nothing. The key stays on the server
// (IDEAL_POSTCODES_API_KEY on Railway); only the postcode is sent — never a name.

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const key = process.env.IDEAL_POSTCODES_API_KEY
    if (!key) return NextResponse.json({ error: "Address lookup isn't set up — IDEAL_POSTCODES_API_KEY is missing on Railway." }, { status: 500 })

    const postcode = (req.nextUrl.searchParams.get("postcode") ?? "").replace(/\s+/g, "").toUpperCase()
    if (!/^[A-Z0-9]{5,8}$/.test(postcode)) return NextResponse.json({ error: "Type a full postcode." }, { status: 400 })

    const res = await fetch(`https://api.ideal-postcodes.co.uk/v1/postcodes/${postcode}?api_key=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(10_000),
    })
    const j = await res.json().catch(() => null)
    if (!res.ok || !Array.isArray(j?.result)) {
      const code = j?.code
      const msg = code === 4040 ? "No addresses found for that postcode — check it, or type the address in."
        : code === 4010 ? "The address lookup doesn't recognise the key on Railway."
        : code === 4011 ? "The address lookup key is limited to certain websites/IPs — clear that restriction on the key in Ideal Postcodes."
        : code === 4020 || code === 4021 ? "The address lookup has run out of credits (or hit its limit) — top up in Ideal Postcodes."
        : `The address lookup didn't answer (${j?.message ?? res.status}).`
      return NextResponse.json({ error: msg }, { status: 502 })
    }
    const addresses = j.result.map((a: Record<string, string | undefined>) => ({
      line1: a.line_1 ?? "", line2: [a.line_2, a.line_3].filter(Boolean).join(", "),
      town: a.post_town ?? "", county: a.county ?? "", postcode: a.postcode ?? "",
    }))
    return NextResponse.json({ addresses })
  } catch (e: any) {
    console.error("address-lookup error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

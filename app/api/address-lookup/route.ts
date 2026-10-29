import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"

// House number/name + postcode → one address, from findaddress.io. The key stays on the server
// (FINDADDRESS_API_KEY on Railway); only the house and postcode are sent — never a name.

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const key = process.env.FINDADDRESS_API_KEY
    if (!key) return NextResponse.json({ error: "Address lookup isn't set up — FINDADDRESS_API_KEY is missing on Railway." }, { status: 500 })

    const house = (req.nextUrl.searchParams.get("house") ?? "").trim().slice(0, 60)
    const postcode = (req.nextUrl.searchParams.get("postcode") ?? "").replace(/\s+/g, "").toUpperCase().slice(0, 10)
    if (!house || !postcode) return NextResponse.json({ error: "Type the house number or name and the postcode." }, { status: 400 })

    const res = await fetch("https://findaddress.io/API/", {
      method: "POST",
      headers: { "x-api-key": key, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ house, postcode }),
      signal: AbortSignal.timeout(10_000),
    })
    const j = await res.json().catch(() => null)
    if (!j || j.result === "Failure" || !j.expandedAddress) {
      const code = String(j?.statusCode ?? res.status)
      const msg = code === "400" ? "That postcode isn't valid."
        : code === "401" ? "The address lookup refused the key (wrong key or subscription ended)."
        : code === "429" ? "The address lookup's daily or monthly limit has been reached."
        : `The address lookup didn't answer (${j?.errorMsg ?? code}).`
      return NextResponse.json({ error: msg }, { status: 502 })
    }
    const a = j.expandedAddress
    return NextResponse.json({
      partial: j.result !== "Success",
      house: a.house ?? "", street: a.street ?? "", locality: a.locality ?? "",
      town: a.town ?? "", county: a.county || a.district || "", postcode: a.pCode ?? "",
    })
  } catch (e: any) {
    console.error("address-lookup error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

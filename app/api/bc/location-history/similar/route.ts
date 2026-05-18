import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAll } from "@/lib/bc"

export const maxDuration = 60

// GET /api/bc/location-history/similar?from=ISO&to=ISO
//
// Returns all location changes (tote Location + item Article Location Code)
// in the given datetime window. Runs two BC queries in parallel since OData
// does not support OR on Field_Caption.

const SELECT = "Primary_Key_Field_1_Value,Primary_Key_Field_2_Value,Old_Value,New_Value,Date_and_Time,User_ID,Field_Caption"

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const token = await getBCToken()
    if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })

    const { searchParams } = req.nextUrl
    const from = searchParams.get("from")
    const to   = searchParams.get("to")
    if (!from || !to) return NextResponse.json({ error: "from and to required" }, { status: 400 })

    // Two queries in parallel — BC OData doesn't support OR on field values
    const toteFilter = `Date_and_Time ge ${from} and Date_and_Time le ${to} and Field_Caption eq 'Location'`
    const itemFilter = `Date_and_Time ge ${from} and Date_and_Time le ${to} and Field_Caption eq 'Article Location Code'`

    const [toteResult, itemResult] = await Promise.allSettled([
      bcFetchAll(token, "ChangeLogEntries", toteFilter, SELECT, 500),
      bcFetchAll(token, "ChangeLogEntries", itemFilter, SELECT, 500),
    ])

    if (toteResult.status === "rejected" && itemResult.status === "rejected") {
      const msg = toteResult.reason?.message ?? "BC query failed"
      throw new Error(`Both BC queries failed. ${msg}`)
    }

    const toteRows = toteResult.status === "fulfilled" ? toteResult.value : []
    const itemRows = itemResult.status === "fulfilled" ? itemResult.value : []

    const partialWarning =
      toteResult.status === "rejected" ? "Tote query failed — only item results shown." :
      itemResult.status === "rejected" ? "Item query failed — only tote results shown." :
      null

    const all = [...toteRows, ...itemRows]
    all.sort((a, b) => (a.Date_and_Time ?? "").localeCompare(b.Date_and_Time ?? ""))

    return NextResponse.json({
      warning: partialWarning,
      entries: all.map(r => ({
        itemKey:   r.Primary_Key_Field_1_Value ?? "",
        itemKey2:  r.Primary_Key_Field_2_Value ?? null,
        from:      r.Old_Value    ?? "",
        to:        r.New_Value    ?? "",
        changedBy: r.User_ID      ?? "",
        changedAt: r.Date_and_Time ?? "",
        type:      r.Field_Caption === "Location" ? "tote" : "item" as "tote" | "item",
      })),
    })
  } catch (e: any) {
    console.error("[location-history/similar]", e)
    return NextResponse.json({ error: e?.message ?? "BC query failed" }, { status: 500 })
  }
}

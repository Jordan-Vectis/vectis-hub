import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { listConditionMailboxFolders } from "@/lib/condition-mailbox"

// GET /api/condition-mailbox/folders
// Lists the connected mailbox's folders so an admin can choose which one to read
// condition-report emails from. Admin only.
export async function GET() {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }
    const result = await listConditionMailboxFolders()
    if (!result.ok) return NextResponse.json({ error: result.error ?? "Failed" }, { status: 400 })
    return NextResponse.json({ folders: result.folders })
  } catch (e: any) {
    console.error("condition-mailbox/folders error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

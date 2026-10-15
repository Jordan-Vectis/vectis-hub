import { redirect } from "next/navigation"

// The April prototype's Inbound wizard was replaced by Goods In → Check in (2026-10-15). This
// address is kept only so old links and bookmarks land on the new screen.

export default function InboundPage() {
  redirect("/tools/warehouse/check-in")
}

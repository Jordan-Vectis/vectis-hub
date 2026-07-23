import { redirect } from "next/navigation"

// Old URL — the page moved when "idle" was removed from user-facing URLs
// (2026-07-23). Kept as a redirect so bookmarks and stale links still work.
export default function OldIdleTimerRedirect() {
  redirect("/admin/activity-timer")
}

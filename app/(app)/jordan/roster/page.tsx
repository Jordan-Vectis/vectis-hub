import { redirect } from "next/navigation"

// The roster now lives as a tab inside the single MCOC section. Old links land
// on that tab.
export default function JordanRosterRedirect() {
  redirect("/jordan/mcoc?tab=roster")
}

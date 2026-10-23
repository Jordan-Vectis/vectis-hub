import { redirect } from "next/navigation"
import { getAccountsAccess } from "@/lib/accounts-auth"
import { getCase } from "@/lib/actions/uncollected"
import { londonDay, parseUncollectedFilter, uncollectedFilterQuery } from "@/lib/uncollected"
import CaseView from "./case-client"
import { BackLink, ErrorNote, NeedsMigrations, PANEL_PATH } from "../ui"

// Accounts → Paid, not collected → one case: the buyer's details (editable in place), its status,
// Log contact, its lots as BC shows them (read live — bc-lots.tsx), the storage-charge start date,
// the timeline, and Delete for a case entered by hand. Admins only, like the panel; every action
// re-checks on the server. BC is only ever READ (the lots, with the admin's own BC sign-in).
//
// The list's filters ride along in the address (?status= &age= &sort=) only so Back returns to the
// same list — nothing else is put in the URL, never the search (the panel keeps that in the tab's
// sessionStorage and puts it back itself).

export const dynamic = "force-dynamic"
export const metadata = { title: "Paid, not collected — case" }

type Params = Promise<{ id: string }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function UncollectedCasePage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { canAccess, isAdmin } = await getAccountsAccess()
  if (!canAccess) redirect("/hub")
  if (!isAdmin) redirect("/tools/accounts/simple")

  const { id } = await params
  const sp = await searchParams
  const backHref = `${PANEL_PATH}${uncollectedFilterQuery(parseUncollectedFilter(sp))}`
  const res = await getCase(id)

  if (!res.ok) {
    return (
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        <BackLink href={backHref}>Paid, not collected</BackLink>
        <div className="mt-3">{res.notReady ? <NeedsMigrations /> : <ErrorNote>{res.error}</ErrorNote>}</div>
      </div>
    )
  }

  return <CaseView c={res.data} today={londonDay()} backHref={backHref} />
}

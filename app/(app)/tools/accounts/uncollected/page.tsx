import { redirect } from "next/navigation"
import { getAccountsAccess } from "@/lib/accounts-auth"
import { listCases } from "@/lib/actions/uncollected"
import { parseUncollectedFilter } from "@/lib/uncollected"
import UncollectedPanel from "./panel-client"
import { BackLink, ErrorNote, NeedsMigrations, card } from "./ui"

// Accounts → Paid, not collected: buyers who have paid but haven't collected their lots.
// Entered by hand for now; a BC feed of paid invoices can fill the same table later (source "bc")
// without this screen changing. ⚠ Nothing here calls or touches Business Central.
//
// Admins only, exactly like Accounts → Reserves — and every action re-checks that on the server.
// Status, age band and order live in the address bar (?status= &age= &sort=), read by
// parseUncollectedFilter. ⚠ The search never does (it is usually a customer's name or email): this
// page always renders the list unsearched, and the panel asks listCases for the search itself.

export const dynamic = "force-dynamic"
export const metadata = { title: "Paid, not collected" }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function UncollectedPage({ searchParams }: { searchParams: SearchParams }) {
  const { canAccess, isAdmin } = await getAccountsAccess()
  if (!canAccess) redirect("/hub")
  // An admin-only power feature, like Reserves — non-admins go to Simple mode.
  if (!isAdmin) redirect("/tools/accounts/simple")

  const sp = await searchParams
  const filter = parseUncollectedFilter(sp)
  const res = await listCases(filter)

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <BackLink href="/tools/accounts">Accounts</BackLink>
      <div className="mt-1 mb-5">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">📦 Paid, not collected</h1>
        <p className="text-base text-gray-500 dark:text-gray-400 mt-1 max-w-3xl">
          Buyers who&apos;ve paid but haven&apos;t collected their lots — who they are, how long they&apos;ve waited,
          and when to chase them next.
        </p>
      </div>

      {res.ok ? (
        <UncollectedPanel list={res.data} />
      ) : res.notReady ? (
        <NeedsMigrations />
      ) : (
        <ErrorNote>{res.error}</ErrorNote>
      )}

      <div className={`${card} p-4 mt-6 border-dashed`}>
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Coming next</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          These are entered by hand for now. Next step: fill this automatically from BC&apos;s paid invoices and the collected flag.
        </p>
      </div>
    </div>
  )
}

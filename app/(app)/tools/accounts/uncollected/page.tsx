import { redirect } from "next/navigation"
import { getAccountsAccess } from "@/lib/accounts-auth"
import { startAgainSite } from "@/lib/uncollected-settings"
import { lastSyncRun, listCases } from "@/lib/actions/uncollected"
import {
  GONE_LOCATIONS, QUERY_LOCATIONS, UNCOLLECTED_AFTER_DAYS, UNCOLLECTED_LOOKBACK_MONTHS, UNCOLLECTED_NIGHTLY_AT, locationListWords,
  parseUncollectedFilter,
} from "@/lib/uncollected"
import BcCheck from "./bc-check"
import UncollectedPanel from "./panel-client"
import StartAgain from "./start-again"
import StorageSettingsBox from "./storage-settings"
import { BackLink, ErrorNote, NeedsMigrations, card } from "./ui"

// Accounts → Paid, not collected: buyers who have paid but haven't collected their lots.
// Filled from BC by the BC check (lib/uncollected-feed.ts — nightly at 08:30, or Check BC now on
// this page), and by hand. ⚠ BC is only ever READ: this page shows when it was last checked, and
// Check BC now starts the same read-only check with the admin's own BC sign-in.
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
  const [res, check] = await Promise.all([listCases(filter), lastSyncRun()])
  // "Start again from BC" — the test sites only (staging, sandbox); the action checks again.
  const site = startAgainSite()

  return (
    <div className="p-4 sm:p-6 max-w-7xl desk:max-w-[1600px] mx-auto">
      <BackLink href="/tools/accounts">Accounts</BackLink>
      <div className="mt-1 mb-5">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">📦 Paid, not collected</h1>
        <p className="text-base text-gray-500 dark:text-gray-400 mt-1 max-w-3xl">
          Buyers who&apos;ve paid but haven&apos;t collected their lots — who they are, how long they&apos;ve waited,
          and when to chase them next.
        </p>
      </div>

      {res.ok ? (
        <>
          <BcCheck
            initial={check.ok ? check.data : null}
            notReady={!check.ok && !!check.notReady}
            readError={check.ok || check.notReady ? null : check.error}
          />
          <UncollectedPanel list={res.data} />
          <StorageSettingsBox settings={res.data.storageSettings} />
          {site && <StartAgain site={site} />}
        </>
      ) : res.notReady ? (
        <NeedsMigrations />
      ) : (
        <ErrorNote>{res.error}</ErrorNote>
      )}

      <HowCasesAreAdded />
    </div>
  )
}

/** The rule, plainly — what puts a buyer on this list and what takes them off. */
function HowCasesAreAdded() {
  const weeks = UNCOLLECTED_AFTER_DAYS % 7 === 0 ? `${UNCOLLECTED_AFTER_DAYS / 7} weeks (${UNCOLLECTED_AFTER_DAYS} days)` : `${UNCOLLECTED_AFTER_DAYS} days`
  return (
    <section className={`${card} p-4 sm:p-5 mt-6`} aria-labelledby="how-added-title">
      <h2 id="how-added-title" className="text-sm font-semibold text-gray-700 dark:text-gray-200">How cases are added</h2>
      <ul className="mt-2 space-y-2 text-sm text-gray-600 dark:text-gray-300 list-disc pl-5 max-w-4xl">
        <li>
          <b>From BC, every morning at {UNCOLLECTED_NIGHTLY_AT}.</b> A buyer is added when a lot <b>sold</b> to them (hammer over £0, not
          withdrawn) is on an invoice BC shows as <b>paid, with nothing left to pay</b>, the lot is <b>still not collected</b>, and
          at least <b>{weeks}</b> have passed since it was paid. One case per invoice, marked <b>From BC</b>, with its next chase
          set to the day it&apos;s added. Sales from the last {UNCOLLECTED_LOOKBACK_MONTHS} months are looked at.
        </li>
        <li>
          <b>Collected — BC&apos;s tick or the lot&apos;s location.</b> BC only ticks a lot Collected once its collection docket is posted,
          and lots are often handed over and scanned to COLLECTED without that. So the check also reads where BC has each lot now, and
          a lot at <b>{locationListWords(GONE_LOCATIONS)}</b> counts as collected, exactly as if it were ticked. A lot
          at <b>{locationListWords(QUERY_LOCATIONS)}</b> isn&apos;t charged or counted in the case&apos;s lots, and the case says to
          check it before chasing. A lot BC has no location for is judged on BC&apos;s tick alone; when BC doesn&apos;t answer for a
          buyer&apos;s lots, that buyer is left as they were until the next check rather than judged on half the picture.
        </li>
        <li>
          <b>Docket · shipment.</b> The check also reads each case&apos;s <b>collection docket</b> (the COL… number on its lots) and
          BC&apos;s <b>shipment request</b> on it: the shipment number (SHP…), its status, and who packed it — the request&apos;s
          Internal Reference. <b>Has a shipment</b> means a shipment request that isn&apos;t cancelled. It&apos;s as fresh as the last
          check, and a case added by hand isn&apos;t read.
        </li>
        <li>
          <b>&ldquo;Paid by&rdquo;</b> — BC doesn&apos;t publish the day the money arrived yet, so a case from BC shows the day BC settled the
          invoice (&ldquo;Paid by (BC settled date)&rdquo;). They paid on or before that day, so they&apos;ve waited at least as long as it says.
          BC does keep each lot&apos;s own paid date; once it&apos;s published the check uses it and the case says <b>&ldquo;Paid on (BC)&rdquo;</b>.
        </li>
        <li>
          <b>Storage charges</b> start the day after the free days run out (see <b>Storage charges</b> above), per lot still here, and
          stop the day a case is closed. They&apos;re worked out live — the figures go up each day — and can be waived on a case, with
          a reason. A lot collected part-way through isn&apos;t charged for the days it was here: the figure is the lots still here
          today, for every day since the start. The Hub never charges anything in BC: the figures are for raising the charge.
        </li>
        <li>
          <b>Already added by hand?</b> The check takes over the open case for the same invoice (or the same buyer and sale, when it
          has no invoice number) instead of adding a second one, and marks it From BC. Its name, sale, invoice, lots, amount and paid
          date then come from BC and can&apos;t be edited here; its status, notes, chase dates and timeline stay as they are.
        </li>
        <li>
          <b>Closed here?</b> If a case for that invoice — or a case added by hand for that buyer and sale with no invoice number — was
          closed here, the check doesn&apos;t add it again.
        </li>
        <li>
          <b>Collected:</b> a case <b>from BC</b> is closed as Collected when BC shows all its lots collected — ticked, or at one of
          those locations; while only some have gone, it carries on with the rest. BC doesn&apos;t say which
          day they went, so the case closes — and its storage stops — on the day of the check before, the last day they could have
          been seen still here. A case added by hand is only closed that way once the check has matched it to its invoice. If BC
          stops showing the invoice as paid, the case stays open and its timeline says to check it.
        </li>
        <li>
          <b>Check BC now</b> runs the same check straight away with your own BC sign-in, and <b>Stop</b> stops it part-way, keeping
          every case it has already saved. Running it twice changes nothing the second time.
        </li>
        <li>
          The check <b>only reads</b> Business Central — nothing is ever written to BC. Anyone the check can&apos;t see can still be
          added by hand with <b>＋ Add a buyer</b>.
        </li>
      </ul>
    </section>
  )
}

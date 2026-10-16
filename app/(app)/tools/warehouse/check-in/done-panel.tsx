"use client"

import Link from "next/link"
import { useEffect, useRef, useState, type ReactNode } from "react"
import type { CustomerRow } from "@/lib/actions/goods-in"
import type { ContainerKind } from "@/lib/goods-in/model"
import { ErrorBox, KindBadge, OkBox, box, btn, btnGo, input, mono } from "../_components/ui"
import { LABELS_TAB, countKinds, fullName, kindsPhrase, labelsUrl, looksLikeEmail } from "./shared"

// The end of a check-in: the receipt number big and plain, then what to do next as three numbered
// steps, each with its own button — label the goods, give the customer their receipt (print it, or
// email it below), put the goods away — and Book in another customer. Printing opens the PDF in a
// new tab (print from there on the iPad's share sheet or the PC's print dialog). Labels may already
// have been printed from the goods step, so the labels button prints the ones that haven't been, or
// all of them again when every one has — its words say which. Email is offered only when an admin
// has connected the mailbox. Every tote and pallet number given is listed at the foot.

export type Booked = {
  receiptId: string
  containers: { id: string; kind: ContainerKind; category: string | null; description: string | null; labelPrintedAt: string | null }[]
  customer: CustomerRow
  /** The vendor number on the receipt (one is given at Book in when they had none and the series is set). */
  vendorNo: string | null
}

type MailStatus = { state: "checking" } | { state: "ready"; connected: boolean; mailbox: string | null } | { state: "unknown" }

const big = "!min-h-12 w-full"
const sectionTitle = "mb-3 text-sm font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300"

/** One of the next steps: its number, what to do, and the button that does it — a row with the button on the right, stacked on a phone. */
function Next({ n, title, children, action, after }: { n: number; title: string; children: ReactNode; action: ReactNode; after?: ReactNode }) {
  return (
    <li className={`${box} flex min-w-0 flex-col gap-3 p-4 @xl:flex-row @xl:items-center @xl:gap-6 sm:px-5`}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">{n}</span>
        <div className="min-w-0">
          <h4 className="text-base font-semibold leading-7 text-gray-900 dark:text-white">{title}</h4>
          <p className="text-sm text-gray-600 dark:text-gray-400">{children}</p>
        </div>
      </div>
      <div className="shrink-0 @xl:w-64">
        {action}
        {after}
      </div>
    </li>
  )
}

export default function DonePanel({ booked, onAnother }: { booked: Booked; onAnother: () => void }) {
  const { receiptId, containers, customer } = booked
  const { totes, pallets } = countKinds(containers)
  const id = encodeURIComponent(receiptId)
  const vendorNo = booked.vendorNo ?? customer.vendorNo
  // A customer with no vendor number is given one at booking when that series is set up — show it.
  const vendorGiven = !customer.vendorNo && booked.vendorNo ? booked.vendorNo : null
  const each = pallets && !totes ? "pallet" : pallets ? "tote and pallet" : "tote"

  const topRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  /** What was opened from here — `labels` is how many labels that press opened (they're "it" or "them"). */
  const [opened, setOpened] = useState<{ receipt?: boolean; labels?: number }>({})
  // Labels printed from this panel (the labels route records them; this keeps the button honest).
  const [printedHere, setPrintedHere] = useState<ReadonlySet<string>>(() => new Set())
  const printed = (c: Booked["containers"][number]) => !!c.labelPrintedAt || printedHere.has(c.id)
  const unprinted = containers.filter(c => !printed(c))
  const nonePrinted = unprinted.length === containers.length
  const labelsHref = unprinted.length && !nonePrinted ? labelsUrl(unprinted.map(c => c.id)) : `/api/goods-in/labels?receipt=${id}`
  const labelsText = nonePrinted
    ? `Print labels (${containers.length})`
    : unprinted.length
      ? `Print the rest (${unprinted.length})`
      : containers.length === 1 ? "Print it again" : `Print all ${containers.length} again`
  const one = containers.length === 1
  const labelsSay = nonePrinted
    ? one ? `Print the label and stick it on the ${each}.` : `Print the labels and stick one on each ${each}.`
    : unprinted.length
      ? `${containers.length - unprinted.length} of ${containers.length} were printed on the goods step — print the rest and stick one on each ${each}.`
      : one ? `Its label was printed on the goods step — check it's on the ${each}.` : `All ${containers.length} were printed on the goods step — check each ${each} has its label on.`

  const [mail, setMail] = useState<MailStatus>({ state: "checking" })
  const [to, setTo] = useState(customer.email ?? "")
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  const [sentTo, setSentTo] = useState<string[]>([])
  const [mailError, setMailError] = useState<string | null>(null)

  useEffect(() => {
    topRef.current?.scrollIntoView({ block: "start" })
    headingRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    let live = true
    fetch("/api/goods-in/mail/status", { cache: "no-store" })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then((j: { configured?: boolean; connected?: boolean; mailbox?: string | null }) => {
        if (live) setMail({ state: "ready", connected: !!j.connected, mailbox: j.mailbox ?? null })
      })
      // Couldn't tell — leave the button on; the send itself will say plainly if it can't go.
      .catch(() => { if (live) setMail({ state: "unknown" }) })
    return () => { live = false }
  }, [])

  const mailOff = mail.state === "ready" && !mail.connected
  const send = async () => {
    if (sendingRef.current || mailOff) return
    const addr = to.trim()
    if (!looksLikeEmail(addr)) { setMailError("That doesn't look like an email address — check it and try again."); return }
    sendingRef.current = true
    setSending(true)
    setMailError(null)
    try {
      const res = await fetch(`/api/goods-in/receipt/${id}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: addr }),
      })
      let j: { ok?: boolean; error?: string } = {}
      try { j = await res.json() } catch { /* not JSON — handled below */ }
      if (!res.ok || !j.ok) {
        setMailError(j.error ?? `The email didn't go (the Hub answered ${res.status}). Try again, or print the receipt instead.`)
        return
      }
      // The email route records who it went to and when (shown on the receipt page).
      setSentTo(s => [...s, addr])
    } catch {
      setMailError("Couldn't reach the Hub to send the email — check the connection and try again.")
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  const openedNote = (text: string) => <p role="status" className="mt-2 text-xs text-gray-500 dark:text-gray-400">{text}</p>

  return (
    <div ref={topRef} className="space-y-8 scroll-mt-4">
      <section className="rounded-2xl border-2 border-emerald-400 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 px-5 py-6 sm:px-8 sm:py-8">
        <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
          <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-xs text-white">✓</span>
          Booked in
        </p>
        <h2 ref={headingRef} tabIndex={-1} className="mt-4 outline-none">
          <span className="block text-sm font-semibold text-gray-600 dark:text-gray-400">Receipt</span>
          <span className={`${mono} block break-all text-5xl font-bold leading-none tabular-nums text-gray-900 dark:text-white sm:text-6xl`}>{receiptId}</span>
          <span className="sr-only"> booked in</span>
        </h2>
        <p className="mt-4 text-base text-gray-700 dark:text-gray-300">
          {kindsPhrase(totes, pallets, " and ")} for <b className="text-gray-900 dark:text-white">{fullName(customer)}</b>
          {vendorNo && !vendorGiven && <> · vendor no. <span className={`${mono} font-semibold`}>{vendorNo}</span></>}
        </p>
        {vendorGiven && (
          <p className="mt-3 inline-flex flex-wrap items-baseline gap-x-2 rounded-lg border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-800 dark:text-gray-200">
            <span>New vendor number given:</span>
            <span className={`${mono} text-base font-bold text-indigo-700 dark:text-indigo-300`}>{vendorGiven}</span>
            <span>— it&apos;s on their receipt.</span>
          </p>
        )}
      </section>

      <section aria-labelledby="gi-done-next">
        <h3 id="gi-done-next" className={sectionTitle}>What to do now</h3>
        <ol className="space-y-2">
          <Next
            n={1}
            title={nonePrinted || unprinted.length ? "Label the goods" : "Check the labels"}
            action={
              <a
                href={labelsHref}
                target={LABELS_TAB}
                rel="noopener"
                className={`${unprinted.length ? btnGo : btn} ${big}`}
                onClick={() => {
                  const ids = (unprinted.length ? unprinted : containers).map(c => c.id)
                  setPrintedHere(s => new Set([...s, ...ids]))
                  setOpened(o => ({ ...o, labels: ids.length }))
                }}
              >
                {labelsText}
              </a>
            }
            after={opened.labels ? openedNote(`Opened in a new tab — print ${opened.labels === 1 ? "it" : "them"} on the label printer (100 × 50 mm).`) : null}
          >
            {labelsSay}
          </Next>
          <Next
            n={2}
            title="Give them their receipt"
            action={
              <a
                // ?print=1 has the PDF route note the receipt as printed; the labels route notes its own.
                href={`/api/goods-in/receipt/${id}/pdf?print=1`}
                target="_blank"
                rel="noopener"
                className={`${btnGo} ${big}`}
                onClick={() => setOpened(o => ({ ...o, receipt: true }))}
              >
                Print receipt
              </a>
            }
            after={opened.receipt && openedNote("Opened in a new tab — print it from there.")}
          >
            Print it for them to sign — or email it to them below.
          </Next>
          <Next
            n={3}
            title="Put the goods away"
            action={<Link href="/tools/warehouse/move" className={`${btn} ${big} font-semibold`}>Open Move</Link>}
          >
            Scan {one ? "the" : "each"} {each} to the storage location it goes to.
          </Next>
        </ol>
        <div className="mt-4 flex flex-col gap-3 @xl:flex-row @xl:items-center">
          <button type="button" className={`${btn} !min-h-12 font-semibold @xl:w-auto w-full`} onClick={onAnother}>Book in another customer</button>
          <Link href={`/tools/warehouse/receipts/${id}`} className={`${btn} !min-h-12 @xl:w-auto w-full`}>Open the receipt</Link>
        </div>
      </section>

      <section aria-labelledby="gi-done-email" className={`${box} p-4 sm:p-5 space-y-3`}>
        <h3 id="gi-done-email" className="text-base font-semibold text-gray-900 dark:text-white">Email the receipt</h3>
        {mailOff && (
          <p className="text-sm text-amber-800 dark:text-amber-300">
            Email isn&apos;t set up yet — an admin connects the mailbox in{" "}
            <Link href="/tools/warehouse/settings" target="_blank" className="font-semibold underline">Goods In → Settings</Link>.
          </p>
        )}
        <div className="flex flex-col gap-2 @xl:flex-row">
          <label htmlFor="gi-email-to" className="sr-only">Email address to send the receipt to</label>
          <input
            id="gi-email-to"
            type="email"
            inputMode="email"
            autoComplete="off"
            className={input}
            value={to}
            onChange={e => { setTo(e.target.value); setMailError(null) }}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void send() } }}
            placeholder={customer.email ? "" : "No email on their record — type one to send it"}
            disabled={mailOff}
          />
          <button
            type="button"
            className={`${btnGo} @xl:shrink-0 whitespace-nowrap`}
            onClick={() => void send()}
            disabled={mailOff || sending || mail.state === "checking" || !to.trim()}
            title={mailOff ? "Email isn't set up yet — an admin connects the mailbox in Goods In → Settings" : undefined}
          >
            {mail.state === "checking" ? "Checking email…" : sending ? "Sending…" : sentTo.length ? "Send again" : "Email receipt"}
          </button>
        </div>
        {mail.state === "ready" && mail.connected && mail.mailbox && (
          <p className="text-xs text-gray-500 dark:text-gray-400">Sent from {mail.mailbox}, with the receipt attached as a PDF.</p>
        )}
        {sentTo.map((a, i) => <OkBox key={`${a}-${i}`}>Receipt {receiptId} emailed to <b>{a}</b>.</OkBox>)}
        {mailError && <ErrorBox onDismiss={() => setMailError(null)}>{mailError}</ErrorBox>}
      </section>

      <section aria-labelledby="gi-done-numbers">
        <h3 id="gi-done-numbers" className={sectionTitle}>
          The numbers given <span className="font-semibold normal-case tracking-normal text-gray-500 dark:text-gray-400">· {kindsPhrase(totes, pallets)}</span>
        </h3>
        <ul className="grid grid-cols-1 gap-2 @xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4">
          {containers.map(c => (
            <li key={c.id} className={`${box} px-4 py-3 min-w-0`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`${mono} text-xl font-bold tabular-nums text-gray-900 dark:text-white`}>{c.id}</span>
                <KindBadge kind={c.kind} />
                {printed(c) && <span className="ml-auto text-xs font-semibold text-emerald-700 dark:text-emerald-300">✓ Label printed</span>}
              </div>
              <p className="mt-1 text-sm font-semibold text-gray-800 dark:text-gray-200 break-words">{c.category ?? <span className="font-normal text-gray-500 dark:text-gray-400">No category</span>}</p>
              {c.description && <p className="text-sm text-gray-600 dark:text-gray-400 break-words">{c.description}</p>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

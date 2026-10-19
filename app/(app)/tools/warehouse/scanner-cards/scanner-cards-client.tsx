"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { cancelScannerCard } from "@/lib/actions/goods-in-scanner-cards"
import { box, btn, btnDanger, btnGo, ErrorBox, input, label, td, th, ukDateTime } from "../_components/ui"

// Goods In → Scanner cards, the working half. Print my sign-in card; for managers, Print a card
// for… anyone with Warehouse access; and the list of cards with Cancel (confirmed in the page,
// never window.confirm).
//
// ⚠ Printing: the card's code exists outside the scanner ONLY in the PDF the Hub answers once, at
// creation. A NEW tab is opened NOW, inside the tap (iPad Safari blocks a tab opened after waiting),
// and a hidden form is posted into it, so that tab loads the card's PDF itself — the way the labels
// screens print, and nothing depends on this page running in the background (iOS can pause it).
// EVERY print gets its own tab: a manager printing several people's cards in a row must never lose
// one card under the next (it can't be shown again). An error shows in that tab in plain words, and
// nothing is made then. This page keeps nothing: no storage, no log, never the code.

export type CardView = {
  id: string
  userId: string
  userName: string | null
  label: string | null
  createdAt: string
  createdByName: string | null
  lastUsedAt: string | null
  revokedAt: string | null
  revokedByName: string | null
}

/** Someone a manager may print a card for. `tier` is their Warehouse access in words ("Manager"). */
export type PersonView = { id: string; name: string; tier: string }

type Props = {
  meId: string
  meName: string | null
  isManager: boolean
  cards: CardView[]
  people: PersonView[]
  /** Why the list couldn't be read (shown instead of it), or null. */
  listError: string | null
  /** Why the people for "Print a card for…" couldn't be read, or null. */
  peopleError: string | null
  /** The cards table isn't on this environment yet (Run Migrations) — the list is left out. */
  notReady: boolean
  /** Why no card can be printed here at all (Run Migrations, or no sign-in secret), or null. */
  blocker: { title: string; body: string } | null
}

const CARD_TAB = "vectis-scanner-card"
const LABEL_MAX = 60
/** How long the print buttons rest after a press (a double tap must not make two cards). */
const PRINT_REST_MS = 4000
/** After a print, coming back to this tab within this long brings the list up to date. */
const REFRESH_FOR_MS = 10 * 60_000

type Note = { who: string; tabOpened: boolean }

export default function ScannerCardsClient({ meId, meName, isManager, cards, people, listError, peopleError, notReady, blocker }: Props) {
  const router = useRouter()
  const busy = useRef(false)
  const printedAt = useRef(0)
  const [printing, setPrinting] = useState<"mine" | "other" | null>(null)
  const [note, setNote] = useState<Note | null>(null)

  const whose = (c: CardView) => (c.userId === meId ? "Your" : `${c.userName || "Someone"}'s`)
  const owner = (c: CardView) => (c.userId === meId ? "You" : c.userName || "—")

  // The card is made in its own tab: when this one is looked at again, the list catches up.
  useEffect(() => {
    const catchUp = () => {
      if (document.visibilityState === "visible" && printedAt.current && Date.now() - printedAt.current < REFRESH_FOR_MS) router.refresh()
    }
    window.addEventListener("focus", catchUp)
    document.addEventListener("visibilitychange", catchUp)
    return () => {
      window.removeEventListener("focus", catchUp)
      document.removeEventListener("visibilitychange", catchUp)
    }
  }, [router])

  const print = (body: { userId?: string; label?: string }, who: string, which: "mine" | "other") => {
    if (busy.current) return
    busy.current = true
    // A tab of its own for THIS card, opened now, inside the tap.
    const name = `${CARD_TAB}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    let w: Window | null = null
    try { w = window.open("", name) } catch { w = null }
    if (w) {
      try {
        w.document.title = "Scanner sign-in card"
        w.document.body.style.cssText = "font:16px system-ui,sans-serif;padding:24px;color:#555"
        w.document.body.textContent = "Making the sign-in card…"
      } catch { /* the tab still gets the card */ }
    }
    // Posted straight away, still inside the tap — with no tab (blocked), the browser either opens one
    // for the form or blocks it, and then nothing reaches the Hub and no card is made.
    const form = document.createElement("form")
    form.method = "post"
    form.action = "/api/goods-in/scanner-cards"
    form.target = name
    form.hidden = true
    for (const [k, v] of Object.entries(body)) {
      if (!v) continue
      const field = document.createElement("input")
      field.type = "hidden"
      field.name = k
      field.value = v
      form.append(field)
    }
    document.body.append(form)
    try { form.submit() } finally { setTimeout(() => form.remove(), 1000) }
    printedAt.current = Date.now()
    setPrinting(which)
    setNote({ who, tabOpened: !!w })
    setTimeout(() => {
      busy.current = false
      setPrinting(null)
      router.refresh()
    }, PRINT_REST_MS)
  }

  // ── Print a card for… (managers) ──
  const [q, setQ] = useState("")
  const [pick, setPick] = useState<PersonView | null>(null)
  const [cardLabel, setCardLabel] = useState("")
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase()
    const all = t ? people.filter(p => p.name.toLowerCase().includes(t)) : people
    return { shown: all.slice(0, 40), more: Math.max(0, all.length - 40) }
  }, [q, people])

  // ── Cancel ──
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [cancelled, setCancelled] = useState<string | null>(null)

  const doCancel = async (c: CardView) => {
    if (cancelling) return
    setCancelling(c.id)
    setCancelError(null)
    setCancelled(null)
    try {
      const res = await cancelScannerCard(c.id)
      if (!res.ok) {
        setCancelError(res.error || "The card couldn't be cancelled — try again.")
      } else {
        setConfirmId(null)
        setCancelled(`${whose(c)} card${c.label ? ` (${c.label})` : ""} is cancelled — it no longer signs in to the scanner.`)
        router.refresh()
      }
    } catch {
      setCancelError("The Hub didn't answer — check the connection and press Cancel again. The card still works until it's cancelled.")
    } finally {
      setCancelling(null)
    }
  }

  const live = cards.filter(c => !c.revokedAt)
  const gone = cards.filter(c => c.revokedAt)

  const printBusy = printing !== null || !!blocker

  const confirmBox = (c: CardView) => (
    <div role="alertdialog" aria-label="Cancel this card?" className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-900 dark:text-red-100 space-y-3">
      <p>
        <b>Cancel {c.userId === meId ? "your" : whose(c)} card{c.label ? ` (${c.label})` : ""}?</b> It stops signing in to the scanner straight away, and anyone signed in with it is signed out. This can&apos;t be undone — print a new card if one is still needed.
      </p>
      {cancelError && <p className="font-semibold">{cancelError}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`${btnDanger} min-h-12 px-5`} disabled={cancelling === c.id} onClick={() => doCancel(c)}>
          {cancelling === c.id ? "Cancelling…" : "Yes, cancel it"}
        </button>
        <button type="button" className={`${btn} min-h-12 px-5`} disabled={cancelling === c.id} onClick={() => { setConfirmId(null); setCancelError(null) }}>
          Keep it
        </button>
      </div>
    </div>
  )

  const cancelBtn = (c: CardView) => (
    <button type="button" className={`${btnDanger} min-h-12`} aria-expanded={confirmId === c.id} onClick={() => { setConfirmId(confirmId === c.id ? null : c.id); setCancelError(null) }}>
      Cancel
    </button>
  )

  return (
    <div className="space-y-8">
      {blocker && (
        <div className="rounded-xl border border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 px-5 py-4 text-sm leading-relaxed max-w-2xl">
          <p className="font-semibold mb-1">{blocker.title}</p>
          <p>{blocker.body}</p>
        </div>
      )}

      {/* ── Print my sign-in card ── */}
      <section className={`${box} p-4 sm:p-6 max-w-2xl`}>
        <button type="button" className={`${btnGo} w-full min-h-16 text-lg`} disabled={printBusy} onClick={() => print({}, "Your", "mine")}>
          {printing === "mine" ? "Making your card…" : "Print my sign-in card"}
        </button>
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
          It opens in a new tab, 100 × 50 mm like a tote label — print it on the label printer. On the scanner, scan its QR code to sign in{meName ? <> as <b>{meName}</b></> : null}.
        </p>
        <NoteLine note={note} />
      </section>

      {/* ── Print a card for… (managers) ── */}
      {isManager && (
        <section className={`${box} p-4 sm:p-6 max-w-2xl space-y-4`}>
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Print a card for someone else</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Managers can print a card for anyone with Warehouse access (an admin&apos;s card only an admin can print). Their older cards keep working unless you cancel them.</p>
          </div>
          {peopleError ? (
            <ErrorBox>{peopleError}</ErrorBox>
          ) : pick ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">Card for</p>
                <p className="text-base font-semibold text-gray-900 dark:text-white truncate">{pick.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{pick.tier}</p>
              </div>
              <button type="button" className={`${btn} min-h-12`} onClick={() => setPick(null)}>Change</button>
            </div>
          ) : (
            <div>
              <label htmlFor="card-for-search" className={label}>Who is it for?</label>
              <input id="card-for-search" type="search" className={input} value={q} onChange={e => setQ(e.target.value)} placeholder="Type their name" autoComplete="off" />
              <ul className="mt-2 max-h-80 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-200 dark:divide-gray-800">
                {matches.shown.length === 0 && (
                  <li className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {people.length === 0 ? "Nobody else has Warehouse access yet." : `Nobody with Warehouse access matches “${q.trim()}”.`}
                  </li>
                )}
                {matches.shown.map(p => (
                  <li key={p.id}>
                    <button type="button" className="w-full text-left min-h-12 px-4 py-2.5 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" onClick={() => { setPick(p); setQ("") }}>
                      <span className="block text-sm font-medium text-gray-900 dark:text-white">{p.name}{p.id === meId ? " (you)" : ""}</span>
                      <span className="block text-xs text-gray-500 dark:text-gray-400">{p.tier}</span>
                    </button>
                  </li>
                ))}
                {matches.more > 0 && <li className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400">…and {matches.more} more — type more of the name to find them.</li>}
              </ul>
            </div>
          )}
          <div>
            <label htmlFor="card-label" className={label}>Label <span className="font-normal text-gray-500 dark:text-gray-400">(optional — e.g. &quot;Spare&quot; or &quot;Night shift&quot;)</span></label>
            <input id="card-label" className={input} value={cardLabel} maxLength={LABEL_MAX} onChange={e => setCardLabel(e.target.value)} autoComplete="off" />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Shown in the list below so you can tell their cards apart. It isn&apos;t printed on the card.</p>
          </div>
          <button
            type="button"
            className={`${btnGo} w-full min-h-14 text-base`}
            disabled={printBusy || !pick}
            onClick={() => pick && print({ userId: pick.id, ...(cardLabel.trim() ? { label: cardLabel.trim() } : {}) }, pick.id === meId ? "Your" : `${pick.name}'s`, "other")}
          >
            {printing === "other" ? "Making the card…" : pick ? `Print a card for ${pick.name}` : "Pick who it's for first"}
          </button>
        </section>
      )}

      {/* ── The cards ── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{isManager ? "Everyone's cards" : "Your cards"}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Every card here signs in to the scanner until it&apos;s cancelled. Lost one, or it&apos;s been photographed? Cancel it and print a new one.
          </p>
        </div>
        {cancelled && <div role="status" className="rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 px-4 py-3 text-sm">{cancelled}</div>}
        {listError && !notReady ? (
          <ErrorBox>{listError}</ErrorBox>
        ) : notReady ? null : live.length === 0 ? (
          <div className={`${box} px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400`}>
            {isManager ? "No cards are working at the moment." : "You have no working cards. Print one above."}
          </div>
        ) : (
          <>
            {/* Phone and upright iPad: one block per card. */}
            <ul className="md:hidden space-y-3">
              {live.map(c => (
                <li key={c.id} className={`${box} p-4 space-y-3`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-gray-900 dark:text-white">{owner(c)}</p>
                      {c.label && <p className="text-sm text-gray-600 dark:text-gray-300">{c.label}</p>}
                    </div>
                    {cancelBtn(c)}
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                    <dt className="text-gray-500 dark:text-gray-400">Made</dt>
                    <dd className="text-gray-800 dark:text-gray-200">{ukDateTime(c.createdAt)}{c.createdByName ? ` by ${c.createdByName}` : ""}</dd>
                    <dt className="text-gray-500 dark:text-gray-400">Last used</dt>
                    <dd className="text-gray-800 dark:text-gray-200">{c.lastUsedAt ? ukDateTime(c.lastUsedAt) : "Not used yet"}</dd>
                  </dl>
                  {confirmId === c.id && confirmBox(c)}
                </li>
              ))}
            </ul>
            {/* Wider: a table. */}
            <div className={`${box} hidden md:block overflow-x-auto`}>
              <table className="w-full">
                <thead className="border-b border-gray-200 dark:border-gray-800">
                  <tr>
                    <th className={th}>Whose</th>
                    <th className={th}>Label</th>
                    <th className={th}>Made</th>
                    <th className={th}>Made by</th>
                    <th className={th} title="Brought up to date at most once an hour">Last used</th>
                    <th className={th}><span className="sr-only">Cancel</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                  {live.map(c => (
                    <CardRow key={c.id} c={c} owner={owner(c)} cancelBtn={cancelBtn(c)} confirm={confirmId === c.id ? confirmBox(c) : null} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {gone.length > 0 && !listError && (
          <details className={`${box} px-4 py-3`}>
            <summary className="cursor-pointer min-h-11 flex items-center text-sm font-semibold text-gray-700 dark:text-gray-200">Cancelled cards ({gone.length})</summary>
            <ul className="mt-2 divide-y divide-gray-200 dark:divide-gray-800">
              {gone.map(c => (
                <li key={c.id} className="py-2.5 text-sm text-gray-500 dark:text-gray-400">
                  <span className="font-medium text-gray-700 dark:text-gray-300">{owner(c)}</span>
                  {c.label ? ` · ${c.label}` : ""} · made {ukDateTime(c.createdAt)}{c.createdByName ? ` by ${c.createdByName}` : ""} · cancelled {ukDateTime(c.revokedAt)}{c.revokedByName ? ` by ${c.revokedByName}` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  )
}

function CardRow({ c, owner, cancelBtn, confirm }: { c: CardView; owner: string; cancelBtn: ReactNode; confirm: ReactNode }) {
  return (
    <>
      <tr>
        <td className={`${td} font-medium`}>{owner}</td>
        <td className={td}>{c.label || <span className="text-gray-400 dark:text-gray-500">—</span>}</td>
        <td className={`${td} whitespace-nowrap`}>{ukDateTime(c.createdAt)}</td>
        <td className={td}>{c.createdByName || "—"}</td>
        <td className={`${td} whitespace-nowrap`}>{c.lastUsedAt ? ukDateTime(c.lastUsedAt) : <span className="text-gray-500 dark:text-gray-400">Not used yet</span>}</td>
        <td className={`${td} text-right`}>{cancelBtn}</td>
      </tr>
      {confirm && (
        <tr>
          <td colSpan={6} className="px-3 pb-3">{confirm}</td>
        </tr>
      )}
    </>
  )
}

function NoteLine({ note }: { note: Note | null }) {
  if (!note) return null
  return (
    <div role="status" className="mt-3 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 px-4 py-3 text-sm space-y-1.5">
      <p>
        {note.who} card is opening in a new tab — print it on the label printer. It can&apos;t be shown again once that tab is closed: if the card goes missing, cancel it below and print another.
      </p>
      <p>If that tab shows a message instead of the card, no card was made — it says why.</p>
      {!note.tabOpened && (
        <p className="font-semibold">If no new tab opened, the browser blocked it: allow pop-ups for the Hub, then press Print again.</p>
      )}
    </div>
  )
}

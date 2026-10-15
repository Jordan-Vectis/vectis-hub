"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { updateReceipt } from "@/lib/actions/goods-in"
import type { ReceiptStatus } from "@/lib/goods-in/model"
import { ErrorBox, OkBox, box, btn, btnDanger, btnGo, input, label, mono, ukDateTime } from "../../_components/ui"
import { useRefreshOnReturn } from "./refresh-on-return"

// The receipt's own buttons: print it, print every label, email it, close/reopen it, void it.
//
// • Print and labels open the PDF in a new tab. The routes record that they went out when the PDF
//   is actually made (the receipt with ?print=1; labels always), so a PDF that fails to build never
//   reads as printed. This page refreshes when someone comes back to it.
// • Email asks GET /api/goods-in/mail/status first; while the mailbox isn't connected the button
//   stays off and SAYS why, rather than failing after someone has typed an address. The email
//   route records the send itself.
// • Void is managers only, and asks in place (never window.confirm — a modal is easy to dismiss by
//   accident on an iPad and blocks the page).

type MailStatus = { configured?: boolean; connected?: boolean; mailbox?: string | null; connectedBy?: string | null; error?: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function ReceiptActions({ id, status, canVoid, snapshotEmail, liveEmail, containerCount, userName }: {
  id: string
  status: ReceiptStatus
  canVoid: boolean
  /** The address on the receipt as it was booked. */
  snapshotEmail: string | null
  /** The customer's record's address now, when it differs from the receipt's. */
  liveEmail: string | null
  containerCount: number
  userName: string | null
}) {
  const router = useRouter()
  const refreshOnReturn = useRefreshOnReturn()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [mail, setMail] = useState<MailStatus | null>(null)
  const [emailOpen, setEmailOpen] = useState(false)
  const [confirmVoid, setConfirmVoid] = useState(false)
  const [voidReason, setVoidReason] = useState("")

  const isVoid = status === "void"
  const pdfHref = `/api/goods-in/receipt/${encodeURIComponent(id)}/pdf?print=1`
  const downloadHref = `/api/goods-in/receipt/${encodeURIComponent(id)}/pdf?download=1`
  const labelsHref = `/api/goods-in/labels?receipt=${encodeURIComponent(id)}`

  // Is the receipts mailbox connected? Asked once when the page opens.
  useEffect(() => {
    let live = true
    fetch("/api/goods-in/mail/status", { cache: "no-store" })
      .then(async r => {
        const j = (await r.json().catch(() => null)) as MailStatus | null
        if (!live) return
        if (!r.ok || !j) setMail({ error: j?.error || `the server answered ${r.status}` })
        else setMail(j)
      })
      .catch(e => { if (live) setMail({ error: String(e?.message ?? e) }) })
    return () => { live = false }
  }, [])

  const emailBlocked: string | null = isVoid
    ? "A void receipt can't be emailed."
    : containerCount === 0
      ? "There are no totes or pallets on this receipt yet, so there's nothing to send."
      : mail === null
        ? "Checking the email connection…"
        : mail.error
          ? `Couldn't check the email connection (${mail.error}).`
          : mail.configured === false
            ? "Emailing receipts isn't set up on this server yet — print it, or download the PDF and email it by hand."
            : !mail.connected
              ? "The receipts mailbox isn't connected — an admin connects it in Goods In → Settings. Until then, print it, or download the PDF and email it by hand."
              : null

  const opened = () => { setError(null); setOk(null); refreshOnReturn() }

  const setStatus = async (next: ReceiptStatus, extra?: { appendNote?: string }) => {
    setBusy(next)
    setError(null)
    setOk(null)
    const res = await updateReceipt(id, { status: next, ...(extra ?? {}) })
    setBusy(null)
    if (!res.ok) { setError(res.error); return }
    setConfirmVoid(false)
    setVoidReason("")
    setOk(next === "closed" ? `Receipt ${id} is closed.` : next === "void" ? `Receipt ${id} is now void. It stays on record.` : `Receipt ${id} is open again.`)
    router.refresh()
  }

  const doVoid = () => {
    const reason = voidReason.trim()
    const line = reason ? `Voided ${ukDateTime(new Date())}${userName ? ` by ${userName}` : ""}: ${reason}` : null
    // Added to the end of the notes on the server, so a note saved since this page loaded is kept.
    void setStatus("void", line ? { appendNote: line } : undefined)
  }

  return (
    <div className="mb-6 space-y-3">
      <div className="flex flex-wrap gap-2">
        {isVoid ? (
          <button type="button" className={btn} disabled title="A void receipt can't be printed.">Print receipt</button>
        ) : (
          <a href={pdfHref} target="_blank" rel="noopener" className={btnGo} onClick={opened}>Print receipt</a>
        )}
        {isVoid || containerCount === 0 ? (
          <button type="button" className={btn} disabled>Print all labels</button>
        ) : (
          <a href={labelsHref} target="_blank" rel="noopener" className={btn} onClick={opened}>
            Print all labels ({containerCount})
          </a>
        )}
        <button type="button" className={btn} disabled={!!emailBlocked} onClick={() => { setOk(null); setError(null); setEmailOpen(true) }}>
          Email receipt
        </button>
        {status === "open" && (
          <button type="button" className={btn} disabled={!!busy} onClick={() => void setStatus("closed")}>
            {busy === "closed" ? "Closing…" : "Close receipt"}
          </button>
        )}
        {status === "closed" && (
          <button type="button" className={btn} disabled={!!busy} onClick={() => void setStatus("open")}>
            {busy === "open" ? "Reopening…" : "Reopen receipt"}
          </button>
        )}
        {isVoid && canVoid && (
          <button type="button" className={btn} disabled={!!busy} onClick={() => void setStatus("open")}>
            {busy === "open" ? "Restoring…" : "Restore receipt"}
          </button>
        )}
        {!isVoid && canVoid && !confirmVoid && (
          <button type="button" className={btnDanger} disabled={!!busy} onClick={() => { setOk(null); setError(null); setConfirmVoid(true) }}>
            Void receipt
          </button>
        )}
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 flex flex-wrap items-center gap-x-3 gap-y-1">
        {emailBlocked && !isVoid && <span>Email: {emailBlocked}</span>}
        {!emailBlocked && mail?.mailbox && <span>Receipts are emailed from <span className="font-medium text-gray-700 dark:text-gray-200">{mail.mailbox}</span>.</span>}
        {!isVoid && (
          <a href={downloadHref} className="inline-flex items-center min-h-11 font-medium text-indigo-700 dark:text-indigo-300 underline">Download the receipt PDF</a>
        )}
      </p>

      {confirmVoid && (
        <div role="alertdialog" aria-labelledby="void-title" className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-4 space-y-3 max-w-2xl">
          <p id="void-title" className="font-semibold text-red-800 dark:text-red-200">Void receipt <span className={mono}>{id}</span>?</p>
          <p className="text-sm text-red-800 dark:text-red-200 leading-relaxed">
            Use this only for a receipt booked in error. It stays on record marked <b>Void</b>; it can&apos;t be printed, emailed or added to.
            Its totes and pallets keep their numbers and stay where they are. A manager can restore it later.
          </p>
          <div>
            <label htmlFor="void-reason" className={label}>Why? (optional — added to the receipt&apos;s notes)</label>
            <input id="void-reason" className={input} value={voidReason} maxLength={300} onChange={e => setVoidReason(e.target.value)} placeholder="e.g. booked onto the wrong customer" />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="inline-flex items-center justify-center min-h-11 px-5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold disabled:opacity-40" disabled={!!busy} onClick={doVoid}>
              {busy === "void" ? "Voiding…" : "Yes, void it"}
            </button>
            <button type="button" className={btn} disabled={!!busy} onClick={() => { setConfirmVoid(false); setVoidReason("") }}>Keep it</button>
          </div>
        </div>
      )}

      {error && <ErrorBox onDismiss={() => setError(null)}>{error}</ErrorBox>}
      {ok && <OkBox>{ok}</OkBox>}

      {emailOpen && (
        <EmailDialog
          id={id}
          initial={snapshotEmail ?? liveEmail ?? ""}
          liveEmail={liveEmail}
          mailbox={mail?.mailbox ?? null}
          onClose={() => setEmailOpen(false)}
          onSent={to => {
            setEmailOpen(false)
            setOk(`Receipt ${id} emailed to ${to}.`)
            // The email route has recorded who it went to and when; fetch the page's fresh copy.
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

function EmailDialog({ id, initial, liveEmail, mailbox, onClose, onSent }: {
  id: string
  initial: string
  liveEmail: string | null
  mailbox: string | null
  onClose: () => void
  onSent: (to: string) => void | Promise<void>
}) {
  const [to, setTo] = useState(initial)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const closeRef = useRef(onClose)
  const sendingRef = useRef(sending)
  useEffect(() => { closeRef.current = onClose; sendingRef.current = sending })

  // Focus the address once on opening; Escape closes (not while it's sending).
  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !sendingRef.current) closeRef.current() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    const addr = to.trim()
    if (!EMAIL_RE.test(addr)) { setError("That doesn't look like an email address — check it and try again."); return }
    setSending(true)
    setError(null)
    try {
      const r = await fetch(`/api/goods-in/receipt/${encodeURIComponent(id)}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: addr }),
      })
      const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!r.ok || !j?.ok) {
        setError(j?.error || `The email wasn't sent (the server answered ${r.status}).`)
        setSending(false)
        return
      }
      await onSent(addr)
    } catch (err) {
      setError(`The email wasn't sent: ${String((err as Error)?.message ?? err)}`)
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4" onClick={() => { if (!sending) onClose() }}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="email-title"
        onSubmit={send}
        onClick={e => e.stopPropagation()}
        className={`${box} w-full max-w-md p-5 space-y-4 shadow-xl`}
      >
        <div>
          <h2 id="email-title" className="text-lg font-bold text-gray-900 dark:text-white">Email receipt <span className={mono}>{id}</span></h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            The receipt goes as a PDF{mailbox ? <> from <span className="font-medium text-gray-700 dark:text-gray-200">{mailbox}</span></> : null}.
          </p>
        </div>
        <div>
          <label htmlFor="email-to" className={label}>Send to</label>
          <input
            ref={inputRef}
            id="email-to"
            type="email"
            inputMode="email"
            autoComplete="off"
            className={input}
            value={to}
            onChange={e => setTo(e.target.value)}
            placeholder="customer@example.com"
            disabled={sending}
          />
          {!initial && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">No email address was given when this receipt was booked — type the customer&apos;s.</p>}
          {liveEmail && liveEmail !== to.trim() && (
            <button type="button" className="mt-2 inline-flex items-center min-h-11 text-left text-sm text-indigo-700 dark:text-indigo-300 underline" onClick={() => setTo(liveEmail)} disabled={sending}>
              Their record now says {liveEmail} — use that
            </button>
          )}
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="flex flex-wrap gap-2 justify-end">
          <button type="button" className={btn} onClick={onClose} disabled={sending}>Cancel</button>
          <button type="submit" className={btnGo} disabled={sending || !to.trim()}>{sending ? `Sending to ${to.trim()}…` : "Send receipt"}</button>
        </div>
      </form>
    </div>
  )
}

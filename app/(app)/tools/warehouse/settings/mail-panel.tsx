"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { box, btn, btnDanger, btnGo, ErrorBox, input, label, mono, OkBox } from "../_components/ui"

// Goods In → Settings → Email. Whether receipts can be emailed from the Hub, the Connect /
// Disconnect buttons (delegated Microsoft sign-in, lib/goods-in/mail.ts), a test send, and a box
// saying exactly what to ask IT for — it can't work until IT has done those three things.

type Status = { configured: boolean; connected: boolean; mailbox: string; connectedBy: string | null; missing: string[] }
type Flash = { ok: true } | { ok: false; reason: string } | null

async function post(url: string, body?: unknown): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    const j = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok || !j || j.ok !== true) return { ok: false, error: typeof j?.error === "string" ? j.error : `The Hub answered with an error (${res.status}). Please try again.` }
    return { ok: true, data: j }
  } catch {
    return { ok: false, error: "Couldn't reach the Hub — check the connection and try again." }
  }
}

/** What a Microsoft refusal usually means, in words IT and the admin can act on. */
function hintFor(reason: string, redirectUri: string): string | null {
  if (/AADSTS50011|redirect/i.test(reason)) return `The return address isn't registered on the app yet — IT needs to add ${redirectUri} (step 2 below).`
  if (/AADSTS65001|AADSTS90094|consent|approval/i.test(reason)) return "IT hasn't granted consent for Mail.Send.Shared yet (step 1 below)."
  if (/AADSTS700016|not found in the directory/i.test(reason)) return "Microsoft couldn't find the app registration — check GRAPH_CLIENT_ID on Railway."
  if (/AADSTS7000215|AADSTS7000222|client secret|secret/i.test(reason)) return "The app's client secret is wrong or has expired — check GRAPH_CLIENT_SECRET on Railway."
  if (/access_denied|cancel/i.test(reason)) return "The Microsoft sign-in was cancelled or refused. Press Connect again when ready."
  return null
}

export default function MailPanel({ status, redirectUri, origin, clientId, flash }: { status: Status; redirectUri: string; origin: string; clientId: string | null; flash: Flash }) {
  const router = useRouter()
  const [banner, setBanner] = useState<Flash>(flash)
  const [confirmOff, setConfirmOff] = useState(false)
  const [busy, setBusy] = useState<"off" | "test" | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testTo, setTestTo] = useState("")
  const [copied, setCopied] = useState(false)
  const askText = useRef<HTMLTextAreaElement>(null)

  // The ?mail=… result has been read into the banner — take it off the address so a reload doesn't repeat it.
  useEffect(() => {
    if (!flash) return
    try {
      const u = new URL(window.location.href)
      u.searchParams.delete("mail"); u.searchParams.delete("reason")
      window.history.replaceState(window.history.state, "", u.pathname + (u.search || "") + u.hash)
    } catch { /* leave the address as it is */ }
  }, [flash])

  const disconnectNow = async () => {
    setBusy("off"); setError(null); setOk(null)
    const res = await post("/api/goods-in/mail/disconnect")
    setBusy(null); setConfirmOff(false)
    if (!res.ok) { setError(res.error); return }
    setBanner(null)
    setOk("Disconnected. Receipts can't be emailed from the Hub until someone connects again — they can still be printed, or downloaded and emailed by hand.")
    router.refresh()
  }

  const sendTest = async () => {
    const to = testTo.trim()
    if (!to) { setError("Type the email address to send the test to."); return }
    setBusy("test"); setError(null); setOk(null)
    const res = await post("/api/goods-in/mail/test", { to })
    setBusy(null)
    if (!res.ok) { setError(res.error); return }
    setOk(`Test email sent to ${String(res.data.sentTo ?? to)} from ${status.mailbox}. Check it arrived — if it did, receipts can be emailed from the counter.`)
  }

  const itRequest = [
    `Please could you set up the Vectis Hub to email Goods In receipts from ${status.mailbox}.`,
    ``,
    `On the existing Entra app registration "Vectis Hub - IT Mailbox"${clientId ? ` (Application (client) ID ${clientId})` : " (the app in GRAPH_CLIENT_ID)"}:`,
    `1. Add the delegated Microsoft Graph permission Mail.Send.Shared, and grant admin consent for it.`,
    `2. Under Authentication (Web platform), add this redirect URI: ${redirectUri}`,
    `3. Give the person who will connect the mailbox "Send As" or "Send on behalf" rights on ${status.mailbox}.`,
  ].join("\n")

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(itRequest)
    } catch {
      // Older browsers / no clipboard permission: select the text so it can be copied by hand.
      askText.current?.select()
      try { document.execCommand("copy") } catch { /* selected, at least */ }
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const hint = banner && !banner.ok ? hintFor(banner.reason, redirectUri) : null

  return (
    <section id="email" aria-labelledby="email-heading" className="space-y-4 scroll-mt-4">
      <div>
        <h2 id="email-heading" className="text-lg font-semibold text-gray-900 dark:text-white">Email</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300 mt-1 max-w-3xl leading-relaxed">
          Receipts are emailed to customers from <b>{status.mailbox}</b>, with the receipt attached as a PDF and a copy kept in that mailbox&apos;s Sent Items.
          Until the mailbox is connected, receipts can be printed, or downloaded and emailed by hand.
        </p>
      </div>

      {banner?.ok && (
        <OkBox>
          <b>The receipts mailbox is connected.</b> Send a test email below to check the account you signed in with is allowed to send from {status.mailbox}.
        </OkBox>
      )}
      {banner && !banner.ok && (
        <ErrorBox onDismiss={() => setBanner(null)}>
          <b>The mailbox couldn&apos;t be connected.</b> {banner.reason || "Microsoft didn't say why."}
          {hint && <span className="block mt-1">{hint}</span>}
        </ErrorBox>
      )}
      {ok && <OkBox>{ok}</OkBox>}
      {error && <ErrorBox onDismiss={() => setError(null)}>{error}</ErrorBox>}

      <div className="grid gap-4 lg:grid-cols-2 items-start">
        {/* ── Status and controls ── */}
        <div className={`${box} p-4 sm:p-5 space-y-4`}>
          <div className="flex items-start gap-3">
            <span aria-hidden className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${status.connected ? "bg-emerald-500" : status.configured ? "bg-gray-400" : "bg-amber-500"}`} />
            <div className="min-w-0">
              <p className="text-base font-semibold text-gray-900 dark:text-white">
                {status.connected ? "Connected" : status.configured ? "Not connected" : "Can't be connected on this environment yet"}
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                {status.connected
                  ? <>Receipts can be emailed from <b>{status.mailbox}</b>.{status.connectedBy && <> Connected by {status.connectedBy}.</>}</>
                  : status.configured
                    ? <>Receipts can&apos;t be emailed from the Hub yet. Once IT has done the steps on the right, connect it here.</>
                    : <>The Hub&apos;s Microsoft settings are missing here: <span className={mono}>{status.missing.join(", ")}</span>. They&apos;re set in Railway&apos;s Variables (the IT mailbox uses the same ones).</>}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {status.configured
              // A full page load on purpose: the route redirects to Microsoft's sign-in, which <Link>'s client-side fetch can't follow.
              // eslint-disable-next-line @next/next/no-html-link-for-pages
              ? <a href="/api/goods-in/mail/connect" className={status.connected ? btn : btnGo}>{status.connected ? "Connect again (another account)" : "Connect the receipts mailbox"}</a>
              : <button type="button" className={btnGo} disabled>Connect the receipts mailbox</button>}
            {status.connected && !confirmOff && <button type="button" className={btnDanger} onClick={() => setConfirmOff(true)}>Disconnect</button>}
          </div>
          {status.configured && (
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              Connect takes you to Microsoft to sign in. Sign in as someone who has Send As or Send on behalf rights on {status.mailbox} — the Hub sends receipts as that account, from that mailbox.
            </p>
          )}

          {confirmOff && (
            <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-3 space-y-3">
              <p className="text-sm text-red-800 dark:text-red-200">Disconnect the receipts mailbox? Nobody will be able to email a receipt from the Hub until it is connected again.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btnDanger} onClick={disconnectNow} disabled={busy === "off"}>{busy === "off" ? "Disconnecting…" : "Yes, disconnect"}</button>
                <button type="button" className={btn} onClick={() => setConfirmOff(false)} disabled={busy === "off"}>Cancel</button>
              </div>
            </div>
          )}

          {status.connected && (
            <div className="border-t border-gray-200 dark:border-gray-800 pt-4 space-y-2">
              <label htmlFor="mail-test" className={label}>Send a test email</label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input id="mail-test" type="email" inputMode="email" autoComplete="email" className={input} value={testTo} placeholder="you@vectis.co.uk"
                  onChange={e => setTestTo(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void sendTest() } }} />
                <button type="button" className={`${btn} shrink-0`} onClick={sendTest} disabled={busy === "test"}>{busy === "test" ? "Sending…" : "Send test"}</button>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">The only way to be sure the connected account may send from {status.mailbox} is to send one.</p>
            </div>
          )}
        </div>

        {/* ── What to ask IT for ── */}
        <div className={`${box} p-4 sm:p-5 space-y-3`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">What to ask IT for</h3>
            <button type="button" className={btn} onClick={copy}>{copied ? "Copied" : "Copy for IT"}</button>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
            On the existing Entra app registration — <b>Vectis Hub - IT Mailbox</b>, the app in <span className={mono}>GRAPH_CLIENT_ID</span>
            {clientId && <> (Application (client) ID <span className={`${mono} break-all`}>{clientId}</span>)</>}:
          </p>
          <ol className="list-decimal pl-5 space-y-2 text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
            <li>Add the <b>delegated</b> Microsoft Graph permission <span className={mono}>Mail.Send.Shared</span>, and <b>grant admin consent</b> for it.</li>
            <li>
              Under Authentication (Web platform), add this redirect URI:
              <span className={`${mono} block mt-1 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2 py-1.5 text-xs break-all select-all`}>{redirectUri}</span>
            </li>
            <li>The person who connects must have <b>Send As</b> or <b>Send on behalf</b> rights on <b>{status.mailbox}</b> (the <span className={mono}>RECEIPTS_MAILBOX</span> setting; admin@vectis.co.uk if it isn&apos;t set).</li>
          </ol>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            The redirect URI is for this Hub ({origin}). Staging and production each need their own, so ask for both if both will email receipts.
            Until this is done, receipts can be printed, or downloaded and emailed by hand.
          </p>
          <textarea ref={askText} readOnly value={itRequest} aria-label="The request for IT, to copy" className="sr-only" tabIndex={-1} />
        </div>
      </div>
    </section>
  )
}

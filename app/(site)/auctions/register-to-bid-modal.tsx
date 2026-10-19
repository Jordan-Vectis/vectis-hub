"use client"

import { useEffect, useId, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { registerToBid } from "@/lib/actions/bidder-registration"

// The terms a bidder agrees to before the account is registered for a sale — a white card over
// the dimmed page. The premium quoted here is the one the rest of the site quotes (22.5% + VAT).

interface Props {
  auctionId: string
  auctionName: string
  onClose: () => void
  onRegistered: () => void
}

export default function RegisterToBidModal({ auctionId, auctionName, onClose, onRegistered }: Props) {
  const router = useRouter()
  const titleId = useId()
  const [tick1, setTick1] = useState(false)
  const [tick2, setTick2] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Escape closes it, and the page behind stays put while it is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = previous }
  }, [onClose])

  function handleRegister() {
    setError(null)
    startTransition(async () => {
      const result = await registerToBid(auctionId)
      if ("error" in result) {
        // No account behind the request, or one whose session has lapsed: the login page, not an error box.
        if (result.error === "not_logged_in" || result.error === "session_expired") {
          onClose()
          router.push("/portal/login")
          return
        }
        setError(result.error === "auction_not_found"
          ? "This sale is no longer open for registration."
          : "Something went wrong. Please try again.")
        return
      }
      onRegistered()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button type="button" className="absolute inset-0 bg-black/50 cursor-default" onClick={onClose} aria-label="Close" tabIndex={-1} />

      <div className="vs-card relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between gap-4 pl-6 pr-3 sm:pl-8 sm:pr-4 py-3 border-b border-[var(--vs-line)]">
          <h2 id={titleId} className="vs-h3">Terms and conditions</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="vs-arrow !border-0 shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="vs-prose px-6 sm:px-8 py-6">
          <p>You are registering to bid in <strong>{auctionName}</strong>.</p>
          <p>
            Please note that submitting any bid is <strong>legally binding</strong>. You do have the option to reduce
            any maximum bid to the current bid level. If you would like to request a bid cancellation please contact
            us <strong>prior to the sale date</strong>.
          </p>
          <p>
            All successful bids require <strong>immediate payment</strong> following the auction. Failure to pay
            immediately could result in your account being suspended, a ban, or legal action being taken.
          </p>
          <p>
            All lots are sold as seen. Descriptions are provided in good faith but buyers are responsible for
            satisfying themselves as to condition prior to bidding. Returns are not accepted.
          </p>
          <p>A buyer&apos;s premium of <strong>22.5% + VAT</strong> is applicable to all lots unless otherwise stated.</p>
          <p>
            Please note that by registering and submitting a bid you are agreeing to our{" "}
            <a href="/terms" target="_blank" rel="noreferrer">Terms &amp; Conditions</a>.
          </p>
        </div>

        <div className="px-6 sm:px-8 py-5 border-t border-[var(--vs-line)] space-y-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={tick1} onChange={e => setTick1(e.target.checked)} className="vs-check mt-0.5 shrink-0" />
            <span className="text-sm">I accept all of the above terms and conditions</span>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={tick2} onChange={e => setTick2(e.target.checked)} className="vs-check mt-0.5 shrink-0" />
            <span className="text-sm">I understand that all bids are legally binding and payment is required immediately upon winning</span>
          </label>
          {error && (
            <p className="text-sm text-[var(--vs-red)] border border-[var(--vs-red)] px-3 py-2" role="alert">{error}</p>
          )}
        </div>

        <div className="px-6 sm:px-8 py-5 border-t border-[var(--vs-line)] flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
          <button type="button" onClick={onClose} className="vs-btn vs-btn-outline">Cancel</button>
          <button type="button" onClick={handleRegister} disabled={!tick1 || !tick2 || isPending} className="vs-btn">
            {isPending ? "Registering…" : "Confirm registration"}
          </button>
        </div>
      </div>
    </div>
  )
}

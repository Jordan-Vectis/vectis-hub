"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { placeCommissionBid } from "@/lib/actions/commission-bid"
import RegisterToBidModal from "../../../register-to-bid-modal"
import { getIncrement, getMinBid, nextBid, roundUpToBid, isValidBid, INCREMENT_TABLE } from "@/lib/bid-increments"

interface Props {
  lotId: string
  auctionId: string
  auctionCode: string
  auctionName: string
  isLoggedIn: boolean
  isRegistered: boolean
  existingMaxBid: number | null
  estimateLow: number | null
  isLive: boolean
  currentBid: number | null
}

export default function LotBidPanel({
  lotId,
  auctionId,
  auctionCode,
  auctionName,
  isLoggedIn,
  isRegistered,
  existingMaxBid,
  estimateLow,
  isLive,
  currentBid,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showRegisterModal, setShowRegisterModal] = useState(false)
  const [showTable, setShowTable] = useState(false)

  const minBid = getMinBid(estimateLow)
  const defaultBid = existingMaxBid ?? minBid

  const [bidAmount, setBidAmount] = useState<number>(defaultBid)
  const [result, setResult] = useState<{
    success?: boolean
    updated?: boolean
    outbid?: boolean
    currentLeadingBid?: number
    error?: string
    suggestedAmount?: number   // increment suggestion
  } | null>(null)

  const currentIncrement = getIncrement(bidAmount)
  const belowMin = bidAmount < minBid
  const invalidIncrement = !belowMin && !isValidBid(bidAmount)
  const suggestedAmount = invalidIncrement ? roundUpToBid(bidAmount) : null

  function stepUp() {
    setBidAmount(prev => nextBid(prev))
    setResult(null)
  }

  function stepDown() {
    setBidAmount(prev => {
      const inc = getIncrement(prev - 1)
      return Math.max(minBid, prev - inc)
    })
    setResult(null)
  }

  function handleManualInput(raw: string) {
    const v = parseInt(raw, 10)
    if (!isNaN(v) && v >= 0) {
      setBidAmount(v)
      setResult(null)
    }
  }

  function acceptSuggestion() {
    if (suggestedAmount) {
      setBidAmount(suggestedAmount)
      setResult(null)
    }
  }

  function handleBidClick() {
    if (!isLoggedIn) {
      router.push(`/portal/login?redirect=/auctions/${auctionCode}/lot/${lotId}`)
      return
    }
    if (!isRegistered) {
      setShowRegisterModal(true)
      return
    }
    submitBid()
  }

  function submitBid() {
    setResult(null)
    startTransition(async () => {
      const res = await placeCommissionBid(lotId, bidAmount)
      if ("error" in res) {
        // Check if the server caught an invalid increment — extract suggestion
        const match = res.error.match(/nearest valid amount is £([\d,]+)/)
        const suggested = match ? parseInt(match[1].replace(/,/g, ""), 10) : undefined
        setResult({ error: res.error, suggestedAmount: suggested })
      } else {
        setResult({
          success: true,
          updated: res.updated,
          outbid: res.outbid,
          currentLeadingBid: res.outbid ? res.currentLeadingBid : undefined,
        })
        router.refresh()
      }
    })
  }

  // Live auction — redirect to live room instead
  if (isLive) {
    return (
      <div className="vs-card-flat p-5">
        <p className="vs-kicker mb-2 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[var(--vs-red)] animate-pulse shrink-0" aria-hidden="true" />
          Auction live now
        </p>
        <p className="text-sm text-[var(--vs-muted)] mb-4">This auction is currently running live. Join to bid in real time.</p>
        <a href={`/auctions/${auctionCode}/live`} className="vs-btn vs-btn-red">Join live auction</a>
      </div>
    )
  }

  const canSubmit = !isPending && !belowMin && !invalidIncrement

  return (
    <>
      <div className="vs-card-flat p-5">
        <h3 className="vs-h4 mb-4">
          {existingMaxBid ? "Update your commission bid" : "Place a commission bid"}
        </h3>

        {/* Existing bid reminder */}
        {existingMaxBid && (
          <p className="text-sm text-[var(--vs-muted)] mb-4">
            Your maximum bid: <span className="vs-price">£{existingMaxBid.toLocaleString("en-GB")}</span>
          </p>
        )}

        {/* Bid stepper */}
        <div className="mb-4">
          <label htmlFor="max-bid" className="vs-label">Maximum bid</label>

          <div className={`flex items-stretch border transition-colors ${
            belowMin || invalidIncrement
              ? "border-[var(--vs-red)]"
              : "border-[var(--vs-line)] focus-within:border-[var(--vs-navy)]"
          }`}>
            {/* Decrement */}
            <button
              type="button"
              onClick={stepDown}
              disabled={bidAmount <= minBid}
              aria-label="Lower the bid by one increment"
              className="w-12 min-h-[48px] text-xl text-[var(--vs-navy)] hover:bg-[var(--vs-bg)] disabled:opacity-30 disabled:cursor-not-allowed border-r border-[var(--vs-line)] transition-colors select-none"
            >
              −
            </button>

            {/* Amount display / manual input */}
            <div className="flex-1 flex items-center justify-center gap-1 px-3 py-2">
              <span className="text-[var(--vs-muted)] text-lg">£</span>
              <input
                id="max-bid"
                type="number"
                min={minBid}
                value={bidAmount}
                onChange={e => handleManualInput(e.target.value)}
                className="w-28 min-w-0 text-center text-2xl font-semibold text-[var(--vs-navy)] !border-0 focus:outline-none bg-transparent"
              />
            </div>

            {/* Increment */}
            <button
              type="button"
              onClick={stepUp}
              aria-label="Raise the bid by one increment"
              className="w-12 min-h-[48px] text-xl text-[var(--vs-navy)] hover:bg-[var(--vs-bg)] border-l border-[var(--vs-line)] transition-colors select-none"
            >
              +
            </button>
          </div>

          <div className="flex items-center justify-between mt-2 text-xs text-[var(--vs-muted)]">
            <p>Minimum bid: <span className="text-[var(--vs-ink)]">£{minBid.toLocaleString("en-GB")}</span></p>
            <p>Increment: <span className="text-[var(--vs-ink)]">£{currentIncrement}</span></p>
          </div>

          {/* Below minimum warning */}
          {belowMin && (
            <p className="text-sm text-[var(--vs-red)] mt-2">
              Minimum bid for this lot is £{minBid.toLocaleString("en-GB")}
            </p>
          )}

          {/* Invalid increment warning — offer to round up */}
          {invalidIncrement && suggestedAmount && (
            <div className="mt-2 vs-band border border-[var(--vs-line)] px-3 py-2.5 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm">
                  £{bidAmount.toLocaleString("en-GB")} isn&apos;t a valid bid increment
                </p>
                <p className="text-xs text-[var(--vs-muted)] mt-0.5">
                  The next valid amount is £{suggestedAmount.toLocaleString("en-GB")}
                </p>
              </div>
              <button type="button" onClick={acceptSuggestion} className="vs-btn vs-btn-sm shrink-0">
                Use £{suggestedAmount.toLocaleString("en-GB")}
              </button>
            </div>
          )}
        </div>

        {/* Result messages */}
        {result?.error && (
          <div className="border border-[var(--vs-red)] px-3 py-2.5 mb-3" role="alert">
            <p className="text-sm text-[var(--vs-red)]">{result.error}</p>
            {result.suggestedAmount && (
              <button
                type="button"
                onClick={() => { setBidAmount(result.suggestedAmount!); setResult(null) }}
                className="vs-link vs-link-sm vs-link-plain mt-2"
              >
                Use £{result.suggestedAmount.toLocaleString("en-GB")} instead
              </button>
            )}
          </div>
        )}

        {/* Outbid notification — red text, as the real site words it */}
        {result?.success && result.outbid && (
          <div className="mb-3" role="status">
            <p className="text-sm text-[var(--vs-red)] leading-snug">
              Another bidder has entered a higher maximum bid and you have been outbid!{" "}
              To have a chance of securing this lot, please increase your maximum bid.
            </p>
            <button
              type="button"
              onClick={() => {
                const newBid = nextBid(result.currentLeadingBid ?? bidAmount)
                setBidAmount(newBid)
                setResult(null)
              }}
              className="vs-link vs-link-sm mt-2"
            >
              Set bid to £{nextBid(result.currentLeadingBid ?? bidAmount).toLocaleString("en-GB")} to take the lead
            </button>
          </div>
        )}

        {/* Bid placed successfully (not outbid) */}
        {result?.success && !result.outbid && (
          <div className="border border-[var(--vs-navy)] text-[var(--vs-navy)] text-sm px-3 py-2 mb-3" role="status">
            {result.updated ? "Your bid has been updated." : "Bid placed successfully. You are currently leading."}
          </div>
        )}

        {/* Place bid button */}
        <button
          type="button"
          onClick={handleBidClick}
          disabled={!canSubmit}
          className="vs-btn vs-btn-block vs-btn-lg mb-3"
        >
          {isPending
            ? "Placing bid…"
            : !isLoggedIn
            ? "Login to bid"
            : !isRegistered
            ? "Register & place bid"
            : existingMaxBid
            ? `Update to £${bidAmount.toLocaleString("en-GB")}`
            : `Place bid — £${bidAmount.toLocaleString("en-GB")}`}
        </button>

        {/* Increment table toggle */}
        <button
          type="button"
          onClick={() => setShowTable(v => !v)}
          aria-expanded={showTable}
          className="vs-link vs-link-sm vs-link-plain mx-auto flex"
        >
          {showTable ? "Hide" : "Show"} bid increment table
        </button>

        {showTable && (
          <table className="w-full mt-3 text-sm border border-[var(--vs-line)]">
            <thead>
              <tr className="vs-band">
                <th scope="col" className="vs-label !mb-0 text-left px-3 py-2">Bid range</th>
                <th scope="col" className="vs-label !mb-0 text-left px-3 py-2">Increment</th>
              </tr>
            </thead>
            <tbody>
              {INCREMENT_TABLE.map((row, i) => {
                const active = bidAmount >= row.from && (row.to === null || bidAmount < row.to)
                return (
                  <tr key={i} className={`border-t border-[var(--vs-line)] ${active ? "bg-[var(--vs-bg)] font-semibold text-[var(--vs-navy)]" : "text-[var(--vs-muted)]"}`}>
                    <td className="px-3 py-1.5">£{row.from.toLocaleString("en-GB")} {row.to ? `– £${row.to.toLocaleString("en-GB")}` : "+"}</td>
                    <td className="px-3 py-1.5">£{row.inc.toLocaleString("en-GB")}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        <p className="text-xs text-[var(--vs-muted)] mt-3 leading-relaxed text-center">
          Commission bids are executed on your behalf up to your maximum.
          A buyer&apos;s premium of 22.5% + VAT applies to all winning lots.
        </p>
      </div>

      {showRegisterModal && (
        <RegisterToBidModal
          auctionId={auctionId}
          auctionName={auctionName}
          onClose={() => setShowRegisterModal(false)}
          onRegistered={() => {
            setShowRegisterModal(false)
            submitBid()
          }}
        />
      )}
    </>
  )
}

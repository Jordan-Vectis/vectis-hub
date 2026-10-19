"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import RegisterToBidModal from "./register-to-bid-modal"

// The bid button on a calendar row or a sale page, labelled as vectis.co.uk labels it: "LOGIN TO
// BID" for a visitor, who is sent to the login page; "REGISTER TO BID" for an account, which
// opens the terms and registers it for the sale — after which the button reads "Registered to bid".

interface Props {
  auctionId: string
  auctionName: string
  isLoggedIn: boolean
  alreadyRegistered: boolean
}

export default function RegisterToBidButton({ auctionId, auctionName, isLoggedIn, alreadyRegistered }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState(alreadyRegistered)

  function handleClick() {
    if (!isLoggedIn) {
      router.push("/portal/login")
      return
    }
    setOpen(true)
  }

  if (done) {
    return (
      // Sized like the buttons it stands beside.
      <span className="vs-badge !py-[9px] border border-[var(--vs-navy)]" role="status">
        <svg className="inline-block -mt-0.5 mr-2" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        Registered to bid
      </span>
    )
  }

  return (
    <>
      <button type="button" onClick={handleClick} className="vs-btn">
        {isLoggedIn ? "Register to bid" : "Login to bid"}
      </button>

      {open && (
        <RegisterToBidModal
          auctionId={auctionId}
          auctionName={auctionName}
          onClose={() => setOpen(false)}
          onRegistered={() => { setDone(true); setOpen(false) }}
        />
      )}
    </>
  )
}

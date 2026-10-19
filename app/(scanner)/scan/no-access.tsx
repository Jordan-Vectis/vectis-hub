"use client"

import CardSignIn from "./card-sign-in"
import { forgetOfflineCopy } from "@/lib/goods-in/scan-client/offline"

// Shown in place of the scanner when whoever is signed in can't use it — a Hub login with no Goods
// In access, or a sign-in card whose person has lost it — with the card sign-in screen underneath:
// the devices are shared, so the way forward is the next person scanning their card (or signing in
// with a password), or signing out.

export default function NoAccess({ name, via }: { name: string | null; via: "hub" | "card" }) {
  return (
    <CardSignIn
      mode="screen"
      current={via}
      beforeLeave={forgetOfflineCopy}
      notice={
        <div className="rounded-xl bg-amber-400 px-3 py-2.5 text-black">
          <p className="text-base font-bold leading-snug">{via === "hub" ? "This account can't use the scanner" : "That card can't use the scanner any more"}</p>
          <p className="mt-0.5 text-[14px] leading-snug">
            {via === "hub"
              ? `${name || "This account"} is signed in, but doesn't have Goods In (Warehouse) access. Ask a Warehouse manager to give it — or scan the card of someone who has it.`
              : "The card signed in on this scanner belongs to someone who no longer has Goods In (Warehouse) access. Scan another card, or sign in below."}
          </p>
        </div>
      }
    />
  )
}

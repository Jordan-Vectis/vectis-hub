import { atLeast, getGoodsInUser } from "@/lib/goods-in/access"
import { getEffectiveSession } from "@/lib/impersonation"
import { listScannerCards, listWarehouseUsers } from "@/lib/actions/goods-in-scanner-cards"
import { CARDS_NOT_SET_UP, scannerCardsConfigured } from "@/lib/goods-in/scanner-pass"
import type { WarehouseRole } from "@/lib/apps"
import { PageHeader } from "../_components/ui"
import ScannerCardsClient, { type CardView, type PersonView } from "./scanner-cards-client"

export const dynamic = "force-dynamic"
export const metadata = { title: "Scanner cards · Goods In" }

// Goods In → Scanner cards. Jack: "Can you give me a QR code to auto sign in please, as there's no
// keyboard" — on the shared Newland scanners. Each person prints a sign-in card here; scanning it
// on the scanner's sign-in screen signs them in, and on a shared scanner the next person scans
// theirs to switch.
//
// ⚠ A card signs in to the SCANNER ONLY (/scan and /api/goods-in/scan/*), never the rest of the
// Hub, and holds a long random code — never a password. The Hub keeps only the code's hash, so the
// card's PDF, answered once by POST /api/goods-in/scanner-cards, is the only copy; a lost card is
// cancelled here. Everyone sees their own cards; a Warehouse manager or admin sees everyone's and
// can print one for anyone with Warehouse access at or below their own tier. No card is printed
// while an admin is viewing as someone. The layout has already let only Goods In users in.
// Nothing here touches Business Central.

const TIER: Record<WarehouseRole, string> = { warehouse: "Warehouse staff", manager: "Manager", admin: "Admin" }

const iso = (d: Date | null) => (d ? d.toISOString() : null)

export default async function ScannerCardsPage() {
  const [me, session] = await Promise.all([getGoodsInUser(), getEffectiveSession()])
  const isManager = atLeast(me, "manager")
  const [cardsRes, peopleRes] = await Promise.all([listScannerCards(), isManager ? listWarehouseUsers() : Promise.resolve(null)])

  const notReady = !cardsRes.ok && cardsRes.error === CARDS_NOT_SET_UP
  const cards: CardView[] = cardsRes.ok
    ? cardsRes.data.map(c => ({
        id: c.id, userId: c.userId, userName: c.userName, label: c.label, createdAt: c.createdAt.toISOString(),
        createdByName: c.createdByName, lastUsedAt: iso(c.lastUsedAt), revokedAt: iso(c.revokedAt), revokedByName: c.revokedByName,
      }))
    : []
  const people: PersonView[] = peopleRes?.ok ? peopleRes.data.map(p => ({ id: p.id, name: p.name, tier: TIER[p.tier] ?? p.tier })) : []

  const blocker = notReady
    ? {
        title: "Scanner sign-in cards need Run Migrations",
        body: "Their table arrives with the next database update. An admin presses Run Migrations (the banner at the top of the Hub), then cards can be printed. Until then, sign in on the scanner with your username and password.",
      }
    : !scannerCardsConfigured()
      ? {
          title: "Scanner sign-in cards aren't set up on this Hub",
          body: "It has no sign-in secret to sign scanner sessions with — tell IT. Until then, sign in on the scanner with your username and password.",
        }
      : session?.isImpersonating
        ? {
            // The route refuses too: a card is a sign-in, so it is only ever made as yourself.
            title: `You're viewing the Hub as ${session.user.name || "someone else"}`,
            body: "A scanner card is a sign-in, so it can't be printed while viewing as someone — it would sign in as them and say they made it. Stop viewing as them to print one (a manager or admin can then print one for them). Cancelling a card still works, and records that you did it.",
          }
        : null

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Scanner cards"
        back={{ href: "/tools/warehouse", label: "Goods In" }}
        intro={
          <>
            Scan your sign-in card on the handheld scanner to sign in — no typing. A card signs in to the <b>scanner only</b>, never the rest of the Hub, and it never holds your password.
            Lost one? Cancel it below and print a new one.
          </>
        }
      />
      <ScannerCardsClient
        meId={me?.id ?? ""}
        meName={me?.name ?? null}
        isManager={isManager}
        cards={cards}
        people={people}
        listError={cardsRes.ok ? null : cardsRes.error}
        peopleError={peopleRes && !peopleRes.ok ? peopleRes.error : null}
        notReady={notReady}
        blocker={blocker}
      />
    </div>
  )
}

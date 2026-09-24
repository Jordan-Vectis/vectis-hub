import AuctionCalendar, { type CalendarParams } from "./calendar"
import { PageBlocks, pageMetadata, publishedPage } from "../page-editor/render"

// The Auction Calendar page. Built in page editor (Website → Pages) once published there; until
// then the built-in calendar below. The calendar itself lives in ./calendar.tsx — the editor's
// "Auction calendar" live block shows the same one.

export const dynamic = "force-dynamic"

export async function generateMetadata() {
  return pageMetadata("auctions", {
    title: "Auction Calendar",
    description:
      "Browse Vectis upcoming and past specialist auctions. Diecast, Matchbox, Corgi, Trains, Vinyl, Comics and more. Bid live or online.",
    openGraph: {
      title: "Auction Calendar — Vectis Auctions",
      description: "Browse upcoming and past specialist auctions. Bid live or online.",
    },
  })
}

export default async function AuctionsPage({ searchParams }: { searchParams: Promise<CalendarParams> }) {
  const sp = await searchParams
  const page = await publishedPage("auctions")
  if (page) return <PageBlocks data={page.data} searchParams={sp} />
  return <AuctionCalendar sp={sp} />
}

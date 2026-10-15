import type { Metadata } from "next"
import { HeroSection, IntroSection, LatestNewsSection, PastAuctionsSection, SellAtAuctionSection, UpcomingSection } from "./home-sections"
import { PageBlocks, pageMetadata, publishedPage } from "./page-editor/render"

// The test website's home page. Built in the page editor (Website → Pages) once published there;
// until then the built-in design below, which follows vectis.co.uk's home page section for section
// (2026-10-14). Its sections live in ./home-sections.tsx — the editor's live blocks show the same ones.

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata("home", {
    title: "Vectis Auctions | The UK's Largest Toy & Collectables Auctioneer",
    description:
      "Vectis is the world's leading specialist toy and collectables auction house. Browse upcoming auctions, view results, bid live or sell your collection.",
    openGraph: {
      title: "Vectis Auctions | The UK's Largest Toy & Collectables Auctioneer",
      description: "The world's leading specialist toy and collectables auction house. Bid live or sell your collection.",
      url: "https://www.vectis.co.uk",
      siteName: "Vectis Auctions",
      type: "website",
    },
  })
}

export default async function HomePage() {
  const page = await publishedPage("home")
  if (page) return <PageBlocks data={page.data} />
  return (
    <div>
      <HeroSection />
      <IntroSection />
      <UpcomingSection />
      <SellAtAuctionSection />
      <PastAuctionsSection />
      <LatestNewsSection />
    </div>
  )
}

import type { Metadata } from "next"
import { HeroSection, SellCtaSection, SpecialismsSection, StatsSection, UpcomingSection, WhyVectisSection } from "./home-sections"
import { PageBlocks, pageMetadata, publishedPage } from "./page-editor/render"

// The test website's home page. Built in the page editor (Website → Pages) once published there;
// until then the built-in design below. Its sections live in ./home-sections.tsx — the editor's
// live blocks (banner, upcoming auctions, stats, specialisms) show the same ones.

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata("home", {
    title: "Vectis Auctions — World's No.1 Diecast Specialist",
    description:
      "Vectis Auctions is the world's leading specialist auction house for diecast, tinplate and collectable toys. Browse upcoming auctions, bid live, or sell your collection.",
    openGraph: {
      title: "Vectis Auctions — World's No.1 Diecast Specialist",
      description:
        "The world's leading specialist auction house for diecast, tinplate and collectable toys. Bid live or sell your collection.",
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
      <UpcomingSection />
      <StatsSection />
      <WhyVectisSection />
      <SellCtaSection />
      <SpecialismsSection />
    </div>
  )
}

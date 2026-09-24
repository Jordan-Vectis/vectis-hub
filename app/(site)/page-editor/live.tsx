import type { ReactNode } from "react"
import { HeroSection, SpecialismsSection, StatsSection, UpcomingSection } from "../home-sections"
import AuctionCalendar, { type CalendarParams } from "../auctions/calendar"
import { DepartmentsIndex, DeptHighlights, DeptPastAuctions, NewsList } from "../departments/sections"
import NewsIndex, { type NewsParams } from "../news-stories/news/index-view"
import PublicSubmitPage from "@/app/submit/page"
import type { LiveType } from "./live-defs"

// How each LIVE block draws on the site — the same server components the built-in pages use, so a
// block shows exactly what the built-in page showed. SERVER ONLY (they read the database); the
// editor never imports this file — it shows the site's own render of a live block in a frame
// (/site-block).
//
// The page's address bar (?tab=past, ?search=…) reaches the calendar and the news listing through
// Puck's `metadata`, which the site's page passes in.

type Props = Record<string, any> & { puck?: { metadata?: { searchParams?: Record<string, string | undefined> } } }
const sp = (p: Props) => (p.puck?.metadata?.searchParams ?? {}) as Record<string, string | undefined>

export const LIVE_RENDERS: Record<LiveType, (p: Props) => ReactNode> = {
  LiveHero: () => <HeroSection />,
  LiveUpcoming: p => <UpcomingSection kicker={p.kicker} heading={p.heading} count={p.count} />,
  LiveCalendar: p => <AuctionCalendar sp={sp(p) as CalendarParams} title={p.title} />,
  LiveStats: () => <StatsSection />,
  LiveSpecialisms: p => <SpecialismsSection kicker={p.kicker} heading={p.heading} />,
  LiveDepartments: p => <DepartmentsIndex kicker={p.kicker} heading={p.heading} intro={p.intro} />,
  LiveHighlights: p => <DeptHighlights slug={p.department ?? ""} kicker={p.kicker} heading={p.heading} />,
  LivePastAuctions: p => <DeptPastAuctions slug={p.department ?? ""} kicker={p.kicker} heading={p.heading} count={p.count} />,
  LiveNews: p => <NewsList department={p.department ?? ""} category={p.category ?? ""} heading={p.heading} count={p.count} layout={p.layout} />,
  LiveNewsIndex: p => <NewsIndex sp={sp(p) as NewsParams} kicker={p.kicker} title={p.title} intro={p.intro} />,
  LiveSellForm: () => <PublicSubmitPage />,
}

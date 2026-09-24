import "../(site)/site.css"

// The frame the page editor shows a LIVE block in (/site-block) — just the block, drawn the way the
// site draws it, with the site's styles and none of the site's menu or footer. Outside the (site)
// group on purpose, so the site's layout doesn't wrap it.
export const metadata = { robots: { index: false, follow: false } }

export default function SiteBlockLayout({ children }: { children: React.ReactNode }) {
  return children
}

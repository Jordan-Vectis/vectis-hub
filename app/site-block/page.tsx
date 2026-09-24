import { Render, type Data } from "@puckeditor/core"
import { siteConfig } from "../(site)/page-editor/site-config"
import { LIVE_DEFS, LIVE_TYPES, type LiveType } from "../(site)/page-editor/live-defs"

// /site-block?type=LiveUpcoming&p={"heading":"…"} — one LIVE block of the page editor, drawn exactly
// as the site draws it, for the editor's canvas to show in a frame (the live blocks read the
// database, which the editor in the browser can't). Behind the Hub login like the rest of the site.

export const dynamic = "force-dynamic"

export default async function SiteBlockPage({ searchParams }: { searchParams: Promise<{ type?: string; p?: string }> }) {
  const { type, p } = await searchParams
  if (!type || !LIVE_TYPES.includes(type as LiveType)) {
    return <p className="p-4 text-sm text-gray-500">Not a live block.</p>
  }
  let props: Record<string, unknown> = {}
  try { props = p ? JSON.parse(p) : {} } catch { props = {} }
  const data: Data = {
    root: { props: {} },
    content: [{ type, props: { ...LIVE_DEFS[type as LiveType].defaultProps, ...props, id: "preview" } }],
  }
  return (
    <div id="site-block-root" className="vectis-site bg-white">
      <Render config={siteConfig} data={data} metadata={{ searchParams: {} }} />
    </div>
  )
}

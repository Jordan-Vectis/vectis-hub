import type { Config } from "@puckeditor/core"
import { PageRoot, ROOT_DEFAULTS, ROOT_FIELDS, STATIC_BLOCKS } from "./blocks"
import { LIVE_DEFS, LIVE_TYPES } from "./live-defs"
import { LIVE_RENDERS } from "./live"

// The page editor's blocks as the SITE draws them — SERVER ONLY. The editor's copy
// (website/pages/edit/editor-config.tsx) shares every block's fields and look; only the live
// blocks differ: here they read the database, there they show this render in a frame.

export const siteConfig: Config = {
  components: {
    ...STATIC_BLOCKS,
    ...Object.fromEntries(LIVE_TYPES.map(t => [t, { label: LIVE_DEFS[t].label, fields: LIVE_DEFS[t].fields, defaultProps: LIVE_DEFS[t].defaultProps, render: LIVE_RENDERS[t] }])),
  } as Config["components"],
  root: {
    fields: ROOT_FIELDS,
    defaultProps: ROOT_DEFAULTS,
    render: ({ children, background }: { children: React.ReactNode; background?: string }) => <PageRoot background={background}>{children}</PageRoot>,
  } as Config["root"],
}

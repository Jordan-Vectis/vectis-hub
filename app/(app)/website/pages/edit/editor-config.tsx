"use client"

import type { Config } from "@puckeditor/core"
import { PageRoot, ROOT_DEFAULTS, ROOT_FIELDS, STATIC_BLOCKS } from "@/app/(site)/page-editor/blocks"
import { LIVE_DEFS, LIVE_TYPES } from "@/app/(site)/page-editor/live-defs"
import LiveFrame from "./live-frame"

// The page editor's blocks as the EDITOR draws them — the same blocks, fields and look as the site
// (app/(site)/page-editor/site-config.tsx), except the live blocks, which show the site's own render
// in a frame. The block list on the left is grouped so the three kinds read apart.

export const editorConfig: Config = {
  categories: {
    layout: { title: "Layout", components: ["Section", "Columns", "Box", "Spacer", "Divider"] },
    words: { title: "Words & pictures", components: ["PageHeader", "Heading", "Text", "Picture", "Buttons", "Video", "Accordion", "Table", "Cards", "Quote", "Job", "Html"] },
    live: { title: "Live from the Hub", components: [...LIVE_TYPES] },
  },
  components: {
    ...STATIC_BLOCKS,
    ...Object.fromEntries(LIVE_TYPES.map(t => {
      const def = LIVE_DEFS[t]
      return [t, {
        label: def.label,
        fields: { ...def.fields, _about: { type: "custom", label: "What this shows", render: () => <p className="text-xs leading-relaxed text-gray-600">{def.help}</p> } },
        defaultProps: def.defaultProps,
        render: (props: Record<string, unknown>) => <LiveFrame type={t} label={def.label.replace(/^Live:\s*/, "")} props={props} />,
      }]
    })),
  } as Config["components"],
  root: {
    fields: ROOT_FIELDS,
    defaultProps: ROOT_DEFAULTS,
    render: ({ children, background }: { children: React.ReactNode; background?: string }) => <PageRoot background={background}>{children}</PageRoot>,
  } as Config["root"],
}

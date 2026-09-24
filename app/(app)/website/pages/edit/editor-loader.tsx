"use client"

import dynamic from "next/dynamic"
import type { EditorProps } from "./page-editor"

// Puck is a browser-only editor (drag and drop, frames, rich text) — it is loaded in the browser
// only, never drawn on the server.
const PageEditor = dynamic(() => import("./page-editor"), {
  ssr: false,
  loading: () => <div className="flex h-[60vh] items-center justify-center text-sm text-gray-500 dark:text-gray-400">Opening the page editor…</div>,
})

export default function EditorLoader(props: EditorProps) {
  return <PageEditor {...props} />
}

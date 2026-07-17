"use client"

import { useState } from "react"

export type Entry = { filename: string; content: string }

// ─── Rendering ────────────────────────────────────────────────────────────────

const TYPE_COLOURS: Record<string, string> = {
  user:      "bg-blue-100 text-blue-700",
  feedback:  "bg-amber-100 text-amber-700",
  project:   "bg-green-100 text-green-700",
  reference: "bg-purple-100 text-purple-700",
}

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { meta: {}, body: content.trim() }
  const meta: Record<string, string> = {}
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(":")
    if (colon === -1) continue
    meta[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
  }
  return { meta, body: match[2].trim() }
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i} className="font-semibold text-gray-900 dark:text-white">{part.slice(2, -2)}</strong>
      : part
  )
}

function renderBody(body: string) {
  return body.split("\n").map((line, i) => {
    if (line.startsWith("# "))   return <h2 key={i} className="text-base font-bold text-gray-900 dark:text-white mt-4 mb-1">{line.slice(2)}</h2>
    if (line.startsWith("## "))  return <h3 key={i} className="text-sm font-semibold text-gray-800 dark:text-gray-200 mt-3 mb-1">{line.slice(3)}</h3>
    if (line.startsWith("### ")) return <h4 key={i} className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-2 mb-0.5">{line.slice(4)}</h4>
    if (line.startsWith("- "))   return <p key={i} className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed pl-3 before:content-['–'] before:mr-2 before:text-gray-400 dark:text-gray-500">{renderInline(line.slice(2))}</p>
    if (line.trim() === "")      return <div key={i} className="h-2" />
    return <p key={i} className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{renderInline(line)}</p>
  })
}

const OPENING_FILENAME = "opening_message.md"

function EntryCard({
  entry, isOpen, onToggle, onCopy, copied, highlight,
}: {
  entry: Entry
  isOpen: boolean
  onToggle: () => void
  onCopy: (e: React.MouseEvent) => void
  copied: boolean
  highlight?: boolean
}) {
  const { meta, body } = parseFrontmatter(entry.content)
  const typeClass = TYPE_COLOURS[meta.type ?? ""] ?? "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"

  return (
    <div
      className={`bg-white dark:bg-gray-900 border rounded-xl overflow-hidden ${
        highlight
          ? "border-blue-300 dark:border-blue-800 ring-1 ring-blue-100 dark:ring-blue-900/40"
          : "border-gray-200 dark:border-gray-700"
      }`}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-start gap-4 px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-900 dark:text-white text-sm">{meta.name ?? entry.filename}</span>
            {meta.type && (
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${typeClass}`}>
                {meta.type}
              </span>
            )}
            <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">{entry.filename}</span>
          </div>
          {meta.description && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{meta.description}</p>
          )}
        </div>
        <span
          role="button"
          tabIndex={0}
          onClick={onCopy}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onCopy(e as unknown as React.MouseEvent) }}
          className={`shrink-0 mt-0.5 text-xs font-medium px-2.5 py-1 rounded-md border transition-colors cursor-pointer ${
            copied
              ? "border-green-500 text-green-600 dark:text-green-400"
              : highlight
                ? "border-blue-500 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:border-gray-300 dark:hover:border-gray-600"
          }`}
        >
          {copied ? "Copied ✓" : "Copy"}
        </span>
        <svg
          className={`w-4 h-4 text-gray-400 dark:text-gray-500 mt-1.5 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="border-t border-gray-100 dark:border-gray-800 px-5 py-4 space-y-1">
          {renderBody(body)}
        </div>
      )}
    </div>
  )
}

// `entries` is filtered on the server (page.tsx) before it ever reaches the
// browser — anything gated out is absent from the RSC payload, not merely
// hidden. Do not import the full list into this file: it is a client component,
// so importing it would ship every entry in the JS bundle to every admin.
export default function MemoryClient({ entries: initialEntries }: { entries: Entry[] }) {
  const [open, setOpen]       = useState<string | null>(null)
  const [entries, setEntries] = useState<Entry[]>(initialEntries)
  const [copied, setCopied]   = useState<string | null>(null)

  function handleCopy(e: React.MouseEvent, entry: Entry) {
    e.stopPropagation()
    const { body } = parseFrontmatter(entry.content)
    navigator.clipboard.writeText(body)
    setCopied(entry.filename)
    setTimeout(() => setCopied(c => (c === entry.filename ? null : c)), 1500)
  }

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    files.forEach(file => {
      if (!file.name.endsWith(".md")) return
      const reader = new FileReader()
      reader.onload = ev => {
        const content = ev.target?.result as string
        setEntries(prev => {
          const existing = prev.findIndex(e => e.filename === file.name)
          if (existing >= 0) {
            const next = [...prev]
            next[existing] = { filename: file.name, content }
            return next
          }
          return [...prev, { filename: file.name, content }].sort((a, b) => a.filename.localeCompare(b.filename))
        })
        setOpen(file.name)
      }
      reader.readAsText(file)
    })
    e.target.value = ""
  }

  const opening = entries.find(e => e.filename === OPENING_FILENAME)
  const rest    = entries.filter(e => e.filename !== OPENING_FILENAME)

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Claude Memory</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            What Claude remembers about you, this project, and how to work with you.
          </p>
        </div>
        <label className="shrink-0 cursor-pointer text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white dark:text-white border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:border-gray-600 px-4 py-2 rounded-lg transition-colors">
          Upload .md
          <input type="file" accept=".md" multiple onChange={handleUpload} className="hidden" />
        </label>
      </div>

      {opening && (
        <section className="mb-8">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
            Start here
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Copy this and paste it as the first message of every new Claude session.
          </p>
          <EntryCard
            entry={opening}
            highlight
            isOpen={open === opening.filename}
            onToggle={() => setOpen(open === opening.filename ? null : opening.filename)}
            onCopy={(e) => handleCopy(e, opening)}
            copied={copied === opening.filename}
          />
        </section>
      )}

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">
          Memory files
        </h2>
        <div className="flex flex-col gap-3">
          {rest.map(entry => (
            <EntryCard
              key={entry.filename}
              entry={entry}
              isOpen={open === entry.filename}
              onToggle={() => setOpen(open === entry.filename ? null : entry.filename)}
              onCopy={(e) => handleCopy(e, entry)}
              copied={copied === entry.filename}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

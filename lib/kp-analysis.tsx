"use client"

import React from "react"

export type KpStatus = "found" | "partial" | "missing"
export type KpMatch  = { line: string; status: KpStatus }
export type Range    = { start: number; end: number; kp: number }

export const KP_COLOURS = [
  { mark: "bg-teal-200 dark:bg-teal-700/60",       dot: "bg-teal-400 dark:bg-teal-500" },
  { mark: "bg-amber-200 dark:bg-amber-700/60",     dot: "bg-amber-400 dark:bg-amber-500" },
  { mark: "bg-sky-200 dark:bg-sky-700/60",         dot: "bg-sky-400 dark:bg-sky-500" },
  { mark: "bg-fuchsia-200 dark:bg-fuchsia-700/60", dot: "bg-fuchsia-400 dark:bg-fuchsia-500" },
  { mark: "bg-lime-200 dark:bg-lime-700/60",       dot: "bg-lime-400 dark:bg-lime-500" },
  { mark: "bg-orange-200 dark:bg-orange-700/60",   dot: "bg-orange-400 dark:bg-orange-500" },
  { mark: "bg-violet-200 dark:bg-violet-700/60",   dot: "bg-violet-400 dark:bg-violet-500" },
  { mark: "bg-rose-200 dark:bg-rose-700/60",       dot: "bg-rose-400 dark:bg-rose-500" },
]
export const kpColour = (i: number) => KP_COLOURS[i % KP_COLOURS.length]

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "in", "on", "to", "with", "for", "its",
  "is", "are", "has", "have", "at", "by", "from", "as", "inside", "within",
  "all", "this", "that", "it", "be", "been", "etc",
])

function esc(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") }

function significantWords(line: string): string[] {
  return line
    .toLowerCase()
    .split(/[^a-z0-9£"']+/i)
    .map(w => w.replace(/^['"]+|['"]+$/g, ""))
    .filter(w => (w.length >= 3 || /^\d{2,}$/.test(w)) && !STOPWORDS.has(w))
}

function wordRegex(word: string): RegExp {
  let stem = word
  for (const suf of ["ing", "ed", "es", "s"]) {
    if (stem.endsWith(suf) && stem.length - suf.length >= 4) { stem = stem.slice(0, -suf.length); break }
  }
  return new RegExp(`\\b${esc(stem)}\\w{0,4}\\b`, "gi")
}

export function analyseKeyPoints(description: string, keyPoints: string): { matches: KpMatch[]; ranges: Range[] } {
  const lines = keyPoints.split("\n").map(l => l.trim()).filter(Boolean)
  const matches: KpMatch[] = []
  const ranges: Range[] = []

  for (let kpIdx = 0; kpIdx < lines.length; kpIdx++) {
    const line = lines[kpIdx]

    let phraseMatched = false
    try {
      const pattern = esc(line).replace(/\\?\s+/g, "\\s+")
      const m = new RegExp(pattern, "i").exec(description)
      if (m) {
        phraseMatched = true
        ranges.push({ start: m.index, end: m.index + m[0].length, kp: kpIdx })
      }
    } catch { /* fall through to word matching */ }

    if (phraseMatched) {
      matches.push({ line, status: "found" })
      continue
    }

    const words = significantWords(line)
    if (words.length === 0) {
      matches.push({ line, status: "missing" })
      continue
    }

    let matched = 0
    for (const w of words) {
      const re = wordRegex(w)
      let any = false
      let m: RegExpExecArray | null
      while ((m = re.exec(description)) !== null) {
        any = true
        ranges.push({ start: m.index, end: m.index + m[0].length, kp: kpIdx })
        if (m.index === re.lastIndex) re.lastIndex++
      }
      if (any) matched++
    }

    const ratio = matched / words.length
    matches.push({ line, status: ratio === 1 ? "found" : ratio >= 0.5 ? "partial" : "missing" })
  }

  ranges.sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: Range[] = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (!last || r.start >= last.end) merged.push({ ...r })
    else if (r.end > last.end) {
      if (last.kp === r.kp) last.end = r.end
      else merged.push({ start: last.end, end: r.end, kp: r.kp })
    }
  }

  return { matches, ranges: merged }
}

export function HighlightedDescription({ description, ranges }: { description: string; ranges: Range[] }) {
  if (!ranges.length) {
    return <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed whitespace-pre-wrap">{description}</p>
  }
  const parts: React.ReactNode[] = []
  let cursor = 0
  ranges.forEach((r, i) => {
    if (r.start > cursor) parts.push(<span key={`p${i}`}>{description.slice(cursor, r.start)}</span>)
    parts.push(
      <mark key={`m${i}`} className={`${kpColour(r.kp).mark} text-gray-900 dark:text-white rounded px-0.5`}>
        {description.slice(r.start, r.end)}
      </mark>
    )
    cursor = r.end
  })
  if (cursor < description.length) parts.push(<span key="tail">{description.slice(cursor)}</span>)
  return <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed whitespace-pre-wrap">{parts}</p>
}

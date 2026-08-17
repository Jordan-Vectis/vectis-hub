"use client"

import React from "react"

// Two matching modes, chosen per auction (Auction Settings → Review tab key point
// matching):
//  - "strict"  — the original behaviour: a key point counts as found only when its
//    wording is (near enough) verbatim in the description. For auctions like trains
//    where the cataloguer's exact wording must survive.
//  - "relaxed" — for auctions (e.g. Dolls & Bears) whose AI pass is allowed to reword
//    key points into flowing sentences. The FACTS still can't change: numbers, codes,
//    editions and sizes are copied character-exact by the AI, so those "hard tokens"
//    are held to an exact match. All hard tokens present but wording different →
//    "reworded — check wording" (amber, still an issue for a human to read); a hard
//    token genuinely absent → red "not found".
// Nothing is auto-trusted in either mode — this only changes how the deterministic
// matcher grades each key point for the human reviewer.
export type KpAnalysisMode = "strict" | "relaxed"

export type KpStatus = "found" | "partial" | "reworded" | "missing"
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

// Normalise number/size notation on the KEY POINT side only (the description is
// never rewritten — highlight offsets index into the original string; tolerant
// regexes below absorb the variance on that side): 1,500 → 1500 (numberPattern
// re-tolerates the comma when matching), 13 inches / 13-inch / 13" → "13in",
// 34 cm / 34cms → "34cm". Stops «13 inches 34cm» misfiring against «13"/34cm».
// ⚠ A spaced bare "in" after a number is the PREPOSITION ("24 in the set",
// "2 in 1") and must NOT be fused into an inches token — only attached "13in",
// quote marks, or the explicit words inch/inches mean the unit.
function normaliseUnits(line: string): string {
  return line
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/(\d+)\s*(?:″|")/g, "$1in")
    .replace(/(\d+)[\s-]*(?:inches|inch)\b/gi, "$1in")
    .replace(/(\d+)[\s-]*(cm|mm)s?\b/gi, "$1$2")
}

function significantWords(line: string): string[] {
  return line
    .toLowerCase()
    .split(/[^a-z0-9£"']+/i)
    .map(w => w.replace(/^['"]+|['"]+$/g, ""))
    .filter(w => (w.length >= 3 || /^\d{2,}$/.test(w)) && !STOPWORDS.has(w))
}

// Exact number matching: 6000 also matches 6,000; a letter suffix is fine (250th,
// 34cm) but further digits are not — "250" must never pass on "2500", which the old
// generic \w{0,4} suffix allowed and silently hid missing points.
//
// ⚠ NO LEADING \b, deliberately. A cataloguer writes the code spaced — "CB 151518" —
// and the AI writes it joined: "Product code CB151518". The tokeniser splits the key
// point on the space, so the token is the bare "151518", and \b cannot match between
// "B" and "1" (both word characters). Every Charlie Bears key point therefore came
// back "not found" however good the description was — which is what "relaxed key
// points doesn't work at all" actually was. Everything that \b was protecting against
// is a DIGIT before the match, which startsInsideNumber checks instead.
function numberPattern(digits: string): string {
  let pattern = digits
  if (digits.length > 3) {
    const chars = digits.split("")
    const out: string[] = []
    for (let i = 0; i < chars.length; i++) {
      if (i > 0 && (chars.length - i) % 3 === 0) out.push(",?")
      out.push(chars[i])
    }
    pattern = out.join("")
  }
  return `${pattern}(?![\\d,]?\\d)\\w{0,4}\\b`
}

// Would this match start part-way through a bigger number? Two ways that happens:
// a digit immediately before it ("151518" inside "9151518"), or a comma/decimal
// point with a digit before that ("250" inside "1,250"). Letters before it are
// FINE and are the point of the change above — that is a product code.
// No lookbehind: old Safari on the shared iPads throws at regex COMPILE time.
// Applies to any match that starts with a digit.
function startsInsideNumber(text: string, index: number): boolean {
  if (index === 0) return false
  if (/\d/.test(text[index - 1])) return true
  return index >= 2 && /[,.]/.test(text[index - 1]) && /\d/.test(text[index - 2])
}

function wordRegex(word: string): RegExp {
  // Size tokens (from normaliseUnits) match any notation in the description,
  // including hyphenated ("13-inch") and plural ("34cms") forms.
  const inches = word.match(/^(\d+)in$/)
  if (inches) return new RegExp(`\\b${inches[1]}[\\s-]*(?:"|″|in\\b|inch(?:es)?\\b)`, "gi")
  const metric = word.match(/^(\d+)(cm|mm)$/)
  if (metric) return new RegExp(`\\b${metric[1]}[\\s-]*${metric[2]}s?\\b`, "gi")
  if (/^\d+$/.test(word)) return new RegExp(numberPattern(word), "gi")

  let stem = word
  for (const suf of ["ing", "ed", "es", "s"]) {
    if (stem.endsWith(suf) && stem.length - suf.length >= 4) { stem = stem.slice(0, -suf.length); break }
  }
  return new RegExp(`\\b${esc(stem)}\\w{0,4}\\b`, "gi")
}

// ── Relaxed-mode hard tokens ──────────────────────────────────────────────────
// The digit-bearing tokens of a key point (sizes, edition numbers, counts, product
// codes). The relaxed AI instruction forbids rewording these, so they must appear
// exactly — a missing one is a genuine red flag even in relaxed mode.

function hardTokens(line: string): string[] {
  return line
    .toLowerCase()
    .split(/[^a-z0-9£"']+/i)
    .map(w => w.replace(/^['"£]+|['"]+$/g, ""))
    .filter(w => /\d/.test(w))
}

function hardTokenRegex(token: string): RegExp {
  const inches = token.match(/^(\d+)in$/)
  if (inches) return new RegExp(`\\b${inches[1]}[\\s-]*(?:"|″|in\\b|inch(?:es)?\\b)`, "gi")
  const metric = token.match(/^(\d+)(cm|mm)$/)
  if (metric) return new RegExp(`\\b${metric[1]}[\\s-]*${metric[2]}s?\\b`, "gi")
  if (/^\d+$/.test(token)) return new RegExp(numberPattern(token), "gi")
  // Alphanumeric code (CB114790, R000016…) — tolerate a stray space after the
  // letter prefix ("CB 114790").
  const code = token.match(/^([a-z]+)(\d[\w/-]*)$/)
  if (code) return new RegExp(`\\b${esc(code[1])}\\s*${esc(code[2])}\\b`, "gi")
  return new RegExp(`\\b${esc(token)}\\b`, "gi")
}

export function analyseKeyPoints(description: string, keyPoints: string, mode: KpAnalysisMode = "strict"): { matches: KpMatch[]; ranges: Range[] } {
  const lines = keyPoints.split("\n").map(l => l.trim()).filter(Boolean)
  const matches: KpMatch[] = []
  const ranges: Range[] = []

  for (let kpIdx = 0; kpIdx < lines.length; kpIdx++) {
    const line = lines[kpIdx]

    let phraseMatched = false
    try {
      const pattern = esc(line).replace(/\\?\s+/g, "\\s+")
      const re = new RegExp(pattern, "gi")
      let m: RegExpExecArray | null
      while ((m = re.exec(description)) !== null) {
        // A purely numeric line must not phrase-match the tail of a larger
        // comma-grouped figure ("250" inside "1,250") — try the next occurrence.
        if (/^\d/.test(m[0]) && startsInsideNumber(description, m.index)) {
          if (m.index === re.lastIndex) re.lastIndex++
          continue
        }
        phraseMatched = true
        ranges.push({ start: m.index, end: m.index + m[0].length, kp: kpIdx })
        break
      }
    } catch { /* fall through to word matching */ }

    if (phraseMatched) {
      matches.push({ line, status: "found" })
      continue
    }

    const normalised = normaliseUnits(line)
    const words = significantWords(normalised)
    // Strict keeps its original "nothing to match on" early exit; relaxed must
    // carry on — a key point that is ONLY a number ("5") has no significant
    // words but does have a hard token to check.
    if (words.length === 0 && mode !== "relaxed") {
      matches.push({ line, status: "missing" })
      continue
    }

    let matched = 0
    for (const w of words) {
      const re = wordRegex(w)
      let any = false
      let m: RegExpExecArray | null
      while ((m = re.exec(description)) !== null) {
        if (/^\d/.test(m[0]) && startsInsideNumber(description, m.index)) continue
        any = true
        ranges.push({ start: m.index, end: m.index + m[0].length, kp: kpIdx })
        if (m.index === re.lastIndex) re.lastIndex++
      }
      if (any) matched++
    }
    const ratio = words.length > 0 ? matched / words.length : 0

    if (mode === "relaxed") {
      const hard = hardTokens(normalised)
      let hardFound = 0
      for (const t of hard) {
        const re = hardTokenRegex(t)
        let any = false
        let m: RegExpExecArray | null
        while ((m = re.exec(description)) !== null) {
          if (/^\d/.test(m[0]) && startsInsideNumber(description, m.index)) continue
          any = true
          ranges.push({ start: m.index, end: m.index + m[0].length, kp: kpIdx })
          if (m.index === re.lastIndex) re.lastIndex++
        }
        if (any) hardFound++
      }

      if (ratio === 1 && hardFound === hard.length) matches.push({ line, status: "found" })
      else if (hard.length > 0) {
        // Numbers/codes/sizes can't legally be reworded — all present means the
        // point was likely rephrased around them (human checks the wording); any
        // absent means a fact is genuinely missing.
        matches.push({ line, status: hardFound === hard.length ? "reworded" : "missing" })
      } else {
        matches.push({ line, status: ratio >= 0.5 ? "reworded" : "missing" })
      }
      continue
    }

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

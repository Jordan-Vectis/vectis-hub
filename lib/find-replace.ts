// Mass find & replace for lot descriptions — the ONE matcher.
//
// ⚠⚠ SHARED BY THE BROWSER AND THE SERVER ON PURPOSE. Manage Lots previews the change in the
// browser ("45 lots, 312 times") and lib/actions/catalogue.ts makes it on the server. If each had
// its own idea of what matches, the preview would promise one thing and the press would do another
// — on a mass edit of a catalogued sale. Both import THIS file; nothing else may reimplement it.
//
// ⚠ LITERAL TEXT, NEVER A PATTERN. What is typed is escaped before it goes near a RegExp, and the
// replacement is applied through a function so "$1" or "$&" in it is just text. Someone replacing
// "£5" must not be writing a regular expression without knowing it.
//
// ⚠ No lookbehind: the older iPads' Safari throws on one at construction, which would take the
// whole panel down. "Whole words" captures the character in front instead and puts it back.

export type FindReplaceOpts = { matchCase: boolean; wholeWord: boolean }

export const FIND_MAX = 200
export const REPLACE_MAX = 500

const SPECIALS = /[.*+?^${}()|[\]\\]/g
const escapeRe = (s: string) => s.replace(SPECIALS, "\\$&")

function build(find: string, o: FindReplaceOpts): RegExp {
  const body = escapeRe(find)
  // A "word" edge = not a letter and not a digit, in any alphabet (Märklin, Citroën).
  const src = o.wholeWord ? `(^|[^\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])` : body
  return new RegExp(src, o.matchCase ? "gu" : "giu")
}

/** Replace every occurrence. `count` is how many were replaced — 0 means the text is untouched. */
export function applyFindReplace(text: string, find: string, replace: string, o: FindReplaceOpts): { text: string; count: number } {
  if (!find || !text) return { text, count: 0 }
  let count = 0
  const out = text.replace(build(find, o), (...m: unknown[]) => {
    count++
    return o.wholeWord ? String(m[1] ?? "") + replace : replace
  })
  return { text: out, count }
}

/** The line holding the first match, before and after — for the preview. Long lines are cut
 *  AROUND the match, so what is shown is the bit that changes. */
export function firstMatchSnippet(text: string, find: string, replace: string, o: FindReplaceOpts, width = 110): { before: string; after: string } | null {
  if (!find || !text) return null
  const m = build(find, o).exec(text)
  if (!m) return null
  const at = m.index + (o.wholeWord ? String(m[1] ?? "").length : 0)
  const start = text.lastIndexOf("\n", at - 1) + 1
  const endNl = text.indexOf("\n", at)
  const line = text.slice(start, endNl < 0 ? text.length : endNl)
  const cut = (s: string, around: number) => {
    if (s.length <= width) return s
    const from = Math.max(0, Math.min(around - Math.floor(width / 3), s.length - width))
    return (from > 0 ? "…" : "") + s.slice(from, from + width) + (from + width < s.length ? "…" : "")
  }
  const pos = at - start
  return { before: cut(line, pos), after: cut(applyFindReplace(line, find, replace, o).text, pos) }
}

// Defensive parsing for the occasionally-invalid JSON Gemini returns. The most common fault
// is an invalid \' escape (a backslash before a single quote, which is NOT legal JSON and makes
// JSON.parse throw). Used by the Double Check / Key Points / Batch routes so a parse failure
// never leaks raw JSON into a UI field.

// Strip any ```json fences, then parse — repairing the common \' mistake before giving up.
/**
 * ⚠⚠ THE INCHES MARK. A size like 6"/15cm or 13"x9" is written with a DOUBLE QUOTE,
 * and a model that does not escape it produces JSON that cannot be parsed — which is
 * constant here, because nearly every bears and diecast description carries one.
 *
 * Escape a quote that is plainly an inches mark: one that follows a DIGIT and is NOT
 * followed by the , } ] or : that would end a real JSON string. So 6"/15cm and 13"x9"
 * are repaired, while the genuine closing quote of "size": "6" is left alone because a
 * comma or brace follows it.
 */
function escapeInchMarks(s: string): string {
  return s.replace(/(\d)"(?!\s*[,}\]:])/g, '$1\\"')
}

// Strip any ```json fences, then parse — repairing the two mistakes models actually
// make (an invalid ' escape, and an unescaped inches mark) before giving up.
export function parseModelJson(s: string): any | null {
  const cleaned = (s ?? "").trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim()
  if (!cleaned) return null
  try { return JSON.parse(cleaned) } catch {}
  try { return JSON.parse(cleaned.replace(/\\'/g, "'")) } catch {}
  // The inches mark is by far the commonest cause here — repairing it means the
  // parse SUCCEEDS and extractJsonField is never reached at all.
  try { return JSON.parse(escapeInchMarks(cleaned)) } catch {}
  try { return JSON.parse(escapeInchMarks(cleaned.replace(/\\'/g, "'"))) } catch {}
  return null
}

// Last resort: pull a single string field's value out of malformed JSON via regex, so a parse
// failure can still salvage e.g. the "revised" or "description" text instead of dropping it.
export function extractJsonField(s: string, key: string): string | null {
  // ⚠⚠ Repair inches marks FIRST. Without this the match stops at the first
  // unescaped quote, so `... swing labels). 6"/15cm.` came back as `... 6` and HALF
  // A DESCRIPTION was handed back as a complete answer (measured 2026-08-19).
  const src = escapeInchMarks(s ?? "")
  const m = src.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`))
  if (!m) return null
  // ⚠ A real JSON string value is followed by , or a closing brace. If it is not,
  // the match ended early on a quote we could not repair — the value is TRUNCATED,
  // so refuse it. Admitting the reply could not be read beats returning half of one.
  if (!/^\s*[,}]/.test(src.slice((m.index ?? 0) + m[0].length))) return null
  return m[1]
    .replace(/\\n/g, "\n").replace(/\\t/g, "\t")
    .replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, "\\")
    .trim()
}

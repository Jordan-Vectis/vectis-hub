// Defensive parsing for the occasionally-invalid JSON Gemini returns. The most common fault
// is an invalid \' escape (a backslash before a single quote, which is NOT legal JSON and makes
// JSON.parse throw). Used by the Double Check / Key Points / Batch routes so a parse failure
// never leaks raw JSON into a UI field.

// Strip any ```json fences, then parse — repairing the common \' mistake before giving up.
export function parseModelJson(s: string): any | null {
  const cleaned = (s ?? "").trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim()
  if (!cleaned) return null
  try { return JSON.parse(cleaned) } catch {}
  try { return JSON.parse(cleaned.replace(/\\'/g, "'")) } catch {}
  return null
}

// Last resort: pull a single string field's value out of malformed JSON via regex, so a parse
// failure can still salvage e.g. the "revised" or "description" text instead of dropping it.
export function extractJsonField(s: string, key: string): string | null {
  const m = (s ?? "").match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`))
  if (!m) return null
  return m[1]
    .replace(/\\n/g, "\n").replace(/\\t/g, "\t")
    .replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, "\\")
    .trim()
}

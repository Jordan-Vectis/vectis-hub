// Reading a fetch() response without turning an infrastructure hiccup into gibberish.
//
// ⚠ WHY THIS EXISTS. Every route in the Hub returns `{ error: string }` (RULES.md), so
// `await res.json()` looks safe — but the response does not always come FROM the Hub.
// When Railway's proxy cannot reach the app it replies with the plain text
// `upstream error`, and `.json()` then throws:
//
//     Unexpected token 'u', "upstream error" is not valid JSON
//
// which is what the user is shown (measured 2026-08-19, Auction AI chat, during a
// deploy to production). The request didn't fail for any reason they can act on, and
// the message tells them nothing. Almost always it means the app was mid-restart.
//
// This is the fetch-side sibling of the deploy-skew handling for server actions.

export type ReadResult<T = any> = { ok: true; data: T } | { ok: false; error: string }

/** True when the body is a proxy/infrastructure reply rather than one of ours. */
function describeNonJson(status: number, body: string): string {
  const text = (body ?? "").trim()

  if (/^upstream error/i.test(text) || status === 502 || status === 503 || status === 504) {
    return "The server didn't answer — it may be restarting after an update. Wait a few seconds and try again."
  }
  if (status === 413) return "That was too large to send."
  if (status === 504) return "The server took too long to answer. Try again."
  // An HTML body is nearly always a proxy or platform error page.
  if (/^\s*<(!doctype|html)/i.test(text)) {
    return `The server returned a page instead of an answer (HTTP ${status}). It may be restarting — try again in a moment.`
  }
  if (!text) return `The server returned an empty response (HTTP ${status}).`
  return `${text.slice(0, 200)}${text.length > 200 ? "…" : ""}`
}

/**
 * Read a JSON response, never throwing a parser error at the user.
 * ⚠ Reads the body ONCE — a Response body cannot be consumed twice, which is why the
 * text is taken first and parsed here rather than calling res.json() then res.text().
 */
export async function readJsonResponse<T = any>(res: Response): Promise<ReadResult<T>> {
  let text = ""
  try { text = await res.text() } catch {
    return { ok: false, error: "The connection dropped before the answer arrived. Try again." }
  }

  let data: any = null
  try { data = JSON.parse(text) } catch {
    return { ok: false, error: describeNonJson(res.status, text) }
  }

  if (!res.ok) {
    return { ok: false, error: String(data?.error ?? res.statusText ?? `Request failed (HTTP ${res.status})`) }
  }
  return { ok: true, data: data as T }
}

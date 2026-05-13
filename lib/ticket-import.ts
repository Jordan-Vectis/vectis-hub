// Helpers for the AM Tickets CSV import. Outlook export, no Sent column —
// we extract dates from the body text instead.

export type RawEmail = {
  subject: string
  body:    string
  from:    string
}

// Normalise subjects to group an email thread. Strips Outlook's "Re: " /
// "Fwd: " plus the AM "[Auction Marketer Support]" prefix that Zendesk adds.
export function normaliseSubject(s: string): string {
  return s
    .replace(/\[Auction Marketer Support\]\s*/gi, "")
    .replace(/\[Request received\]\s*/gi, "")
    .replace(/^(Re|Fwd|FW):\s*/gi, "")
    .replace(/^(Re|Fwd|FW):\s*/gi, "")  // strip twice — "Re: Re: foo"
    .trim()
    .toLowerCase()
}

// Subjects we want to skip entirely — automated noise that isn't a real ticket.
export function isNoise(subject: string): boolean {
  const s = subject.toLowerCase()
  if (s.includes("presale checks confirmation")) return true
  if (s.includes("presal checks confirmation"))  return true   // observed typo
  if (s.startsWith("follow up to "))             return true
  if (s.includes("set to solved"))               return true
  if (s.includes("user profile updated"))        return true
  if (s.includes("[request received]"))          return true
  return false
}

// Cap body length we feed to Gemini — long threads add tokens but the tail
// is usually footer / signature / quoted history boilerplate.
export function trimBody(body: string, max = 6000): string {
  if (body.length <= max) return body
  return body.slice(0, max) + "\n…(truncated)"
}

// Group emails into ticket threads keyed by normalised subject.
export function groupThreads(emails: RawEmail[]): Map<string, RawEmail[]> {
  const threads = new Map<string, RawEmail[]>()
  for (const e of emails) {
    if (isNoise(e.subject)) continue
    const key = normaliseSubject(e.subject)
    if (!key) continue
    const arr = threads.get(key) ?? []
    arr.push(e)
    threads.set(key, arr)
  }
  return threads
}

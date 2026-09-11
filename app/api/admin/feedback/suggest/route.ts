import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { AI_TOOLS, getToolModel } from "@/lib/ai-models"
import { generateAiText, providerOf, AiBlockedError, AiNotConfiguredError } from "@/lib/ai-provider"
import { parseModelJson } from "@/lib/model-json"
import { friendlyGeminiError, geminiErrorKind, isRateLimitError, isTransientGeminiError } from "@/lib/gemini-retry"
import { hasToolCallLeak } from "@/lib/description-cleanup"
import { APP_CARD_DEFS } from "@/lib/app-cards"
import { DESTINATIONS } from "@/lib/help-map"
import { MAX_QUESTION_CHARS, MAX_QUESTIONS } from "@/lib/feedback-types"

export const maxDuration = 60

// POST /api/admin/feedback/suggest
// Body:    { focus?: string, count?: number (1–10, default 6), existing?: string[] }
// Returns: { questions: string[] }  ·  or { error: string } with a real status
//
// 📝 Hub Feedback — the AI question writer (Jordan, 2026-09-10: "the option to get AI to make up
// some questions and then the ability to change and add my own"). It only SUGGESTS: nothing is
// saved here. The admin screen drops the suggestions into the survey's editor, where Jordan
// changes or deletes them before anything goes out.
//
// ⚠ The questions are answered IN WRITING, with the person's name attached (his decisions). So
// every question must invite a sentence, never a yes/no or a 1-to-5, and must never read like an
// assessment of the person — the prompt says so, and the guards below catch the obvious misses.
//
// ⚠ Honesty over completeness: a reply that can't be read, came back empty, or is a leaked tool
// call is an ERROR, never whatever fragment happened to parse. A shorter list than asked for is
// fine — that just means some suggestions failed a guard — but it is never padded.

const SLOT = "feedback_questions"
// Named in error messages so Jordan knows which dropdown in Admin → AI Models to change.
const SLOT_LABEL = AI_TOOLS.find(t => t.slot === SLOT)?.label ?? "Feedback surveys — suggest questions"

const DEFAULT_COUNT = 6
const MAX_COUNT = 10
const MAX_FOCUS_CHARS = 500

// ── What the Hub is, for the model ──────────────────────────────────────────
// Built from the app's own structure (the Hub cards + the Help box's DESTINATIONS), the same
// sources the Help box reads, so it follows the app as it changes instead of going stale here.
// Favours the cataloguing tools because the tablet cataloguers are who these surveys are for.
//
// ⚠ Capped so the prompt stays small: a question writer does not need the whole Hub, and a long
// list just makes the model circle whichever tool it read about most.

/** The Hub cards a cataloguer actually works in. ⚠ Card keys, not labels — labels are editable. */
const CARD_KEYS = ["CATALOGUING", "WEBSITE_SEARCH", "AUCTION_AI", "PHOTO_PREP"]

/** ⚠ Hand-written, so it is the part that can go stale. It exists because the lot wizard — the
 *  screen cataloguers spend their day in — is what they CALL it, and neither list uses that name. */
const EXTRA_LINES = [
  "The lot wizard — the step-by-step screens for adding one lot: the tote and vendor, the barcode, categories, key points, the estimate and the condition. Used on the shared iPads and on office computers.",
]

const MAX_CONTEXT_LINES = 26
const MAX_LINE_CHARS = 220
const MAX_CONTEXT_CHARS = 5000

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

function hubContextText(): string {
  const cards = CARD_KEYS
    .map(k => APP_CARD_DEFS.find(c => c.key === k))
    .filter((c): c is (typeof APP_CARD_DEFS)[number] => !!c && !c.comingSoon)
    .map(c => `${c.defaultLabel} — ${c.defaultDescription}`)

  // Cataloguing first, then Auction AI, then the sold-price databases — the order is the weight.
  const dest = (keep: (d: (typeof DESTINATIONS)[number]) => boolean) =>
    DESTINATIONS.filter(keep).map(d => `${d.name} — ${d.what}`)
  const places = [
    ...dest(d => d.app === "CATALOGUING"),
    ...dest(d => d.app === "AUCTION_AI"),
    ...dest(d => !d.app && d.href.startsWith("/databases")),
  ]

  const lines: string[] = []
  let chars = 0
  for (const raw of [...EXTRA_LINES, ...cards, ...places]) {
    if (lines.length >= MAX_CONTEXT_LINES) break
    const line = `- ${clip(raw, MAX_LINE_CHARS)}`
    if (chars + line.length > MAX_CONTEXT_CHARS) break
    lines.push(line)
    chars += line.length + 1
  }
  return `THE SCREENS AND TASKS THE PEOPLE ANSWERING USE\n${lines.join("\n")}`
}

// Computed once: the sources are code constants, so it is the same on every call — which is also
// what lets Claude cache it (it goes in cachePrefix, see lib/ai-provider.ts).
const HUB_CONTEXT = hubContextText()

// The stable half of the prompt — identical on every call, so it goes in `system`, which
// generateAiText sends as a cache-marked block on Claude. Anything per-request stays in `prompt`.
const SYSTEM = `You write questions for a short written feedback survey inside the Vectis Hub — the internal web app used by staff at Vectis Auctions, a UK toy and collectables auction house in Thornaby, part of the Hambleton Group.

The people answering are mostly cataloguers. They use the Hub all day, on shared iPads in the warehouse and on office computers: adding lots in the lot wizard, photographing them, checking descriptions and getting sales ready. The survey is run by the person who builds the Hub, who wants to learn how it works for them day to day and what would make it better. Every answer is typed, and each person's name is attached to what they write.

WHAT MAKES A GOOD QUESTION HERE
- Open-ended: it must invite a written answer of a sentence or more. NEVER a yes/no question ("Do you…", "Is the…", "Would you…", "Have you…"), NEVER a rating ("from 1 to 5", "on a scale", "out of 10"), never multiple choice. Start with What, How, Which, When, Where, Why, or "Tell us about…".
- Not leading: "What slows you down when you add photos to a sale?" — never "Isn't the new photo screen quicker?". Do not assume a tool is good or bad.
- One idea per question. Never two questions joined with "and" or "or".
- Short and plain: under 25 words, everyday British English that a non-technical person reads at a glance. No technical words (database, API, sync, server, model, prompt, interface, UX).
- Concrete: tie it to a real screen or task from the list you are given — named the way the list names it — or to their working day in general (the start of the day, a busy sale, an unusual lot). Spread the questions across different parts of the job rather than circling one tool.
- About the Hub and how they work with it. NEVER about pay, hours, managers, colleagues, their health or anything personal, and never about how fast or how much they work — nobody should feel they are being assessed.
- British spelling ("colour", "organise", "catalogue", "favourite").

NEVER WRITE
- A question that repeats or rephrases one the survey already has — you will be shown them.
- Instructions, headings, numbering or commentary. Only the questions themselves.

OUTPUT
Raw JSON only, exactly this shape: {"questions": ["first question", "second question"]}`

// ── Recognising question kinds ──────────────────────────────────────────────
// Used both to TELL the model (does the survey already ask for features?) and to GUARD what comes
// back. ⚠ Kept narrow on purpose: a guard that drops a perfectly good question is worse than one
// that lets a rare miss through to a screen where Jordan edits every question anyway.

/** Straight apostrophes and lower case, so "doesn’t" and "doesn't" match the same pattern. */
function plain(s: string): string {
  return s.replace(/[‘’]/g, "'").toLowerCase()
}

/** A "what would you like the Hub to do" question. Matches FEATURE_QUESTION_TEXT, which every new
 *  survey starts with — so normally the survey already has one and the model is told not to add another.
 *  ⚠ Not the bare word "feature": "Which feature of the lot wizard slows you down?" is an ordinary
 *  question, and because nearly every survey already HAS a feature question, matching the bare word
 *  quietly dropped it. Only the asking-for-something-new shapes count. */
const FEATURE_RE =
  /\b(new|extra|missing) features?\b|\bfeatures? (you'?d|you would|you) (like|want|love|wish)|\bfeature requests?\b|\bany features?\b|doesn't do (yet|at the moment|now)|\b(like|want|wish|love) (the hub|it) (to|could|would) (do|have|be able|offer)|\bif you could add\b|\badded to the hub\b|\bwish ?list\b|\bnew tools?\b/

/** The admin's focus asks for feature questions — then his focus wins over the one-feature rule. */
const FEATURE_FOCUS_RE = /\bfeatures?\b|\bwish ?list\b|\bnew tools?\b|\bwould like the hub\b/

/** Opens like a yes/no question. ⚠ "Is there…" / "Are there…" are allowed through — "Is there
 *  anything you'd like the Hub to do…" is the house feature question and reads as an invitation.
 *  So are "Can you describe…" / "Could you tell us…" / "Would you explain…": those ARE invitations
 *  to write, and a guard that drops a good question is worse than one that misses a bad one. */
const YES_NO_RE =
  /^(do|does|did|is|are|was|were|can|could|would|will|should|have|has|had|am)\b(?!\s+there\b)(?!\s+you\s+(describe|tell|explain|walk|talk|share|give)\b)/

const RATING_RE = /\bscale\b|\b(rate|rating|score)\b|\bout of (5|10|five|ten)\b|\b(1|one) ?(to|-|–) ?(5|10|five|ten)\b/

/** The topics Jordan's brief rules out. ⚠ Not bare "manager": "Auction Manager" is a tool. */
const PERSONAL_RE =
  /\b(salary|wages?|pay rise|your pay|bonus|boss|colleagues?|co-?workers?|line manager|your manager|supervisor|personal life|your health)\b/

const isFeatureQuestion = (q: string) => FEATURE_RE.test(plain(q))

// ── Tidying and de-duplicating ──────────────────────────────────────────────

/** One suggestion as the model wrote it → a clean one-line question, or "" when unusable.
 *  Models sometimes wrap each item as {"question": "…"} instead of a bare string — accepted. */
function tidyQuestion(raw: unknown): string {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null
  const val = typeof raw === "string" ? raw : typeof obj?.question === "string" ? obj.question : typeof obj?.text === "string" ? obj.text : ""
  return val
    .replace(/\*\*|__|`/g, "")                                   // markdown the popup would show literally
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:[-*•]|\d{1,2}[.):]|q\d{1,2}[.):]?)\s+/i, "")   // "1. ", "- ", "Q3: "
    .replace(/^["“]+|["”]+$/g, "")                               // wrapping quotes
    .trim()
}

/** For exact-duplicate checks: case, punctuation and spacing ignored. */
function norm(s: string): string {
  return plain(s).replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim()
}

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "at", "for", "with", "from", "by", "as", "about",
  "you", "your", "you're", "you'd", "yourself", "we", "us", "our", "i", "me", "my", "it", "its", "this", "that",
  "is", "are", "be", "been", "do", "does", "did", "can", "could", "would", "will", "should", "have", "has",
  "what", "how", "which", "when", "where", "why", "who", "there", "any", "anything", "something", "if",
  "hub", "tell", "us", "most", "more", "ever", "one",
])

function contentWords(s: string): Set<string> {
  return new Set(norm(s).split(" ").filter(w => w.length > 1 && !STOPWORDS.has(w)))
}

/** A light "same question, reworded" check: the same content words, near enough. ⚠ Only judged
 *  when both have at least three content words — below that, overlap says nothing, and two short
 *  questions about the same tool are often genuinely different questions. */
function nearDuplicate(a: Set<string>, b: Set<string>): boolean {
  if (a.size < 3 || b.size < 3) return false
  let shared = 0
  for (const w of a) if (b.has(w)) shared++
  return shared / (a.size + b.size - shared) >= 0.7
}

// ── Failures, in words the admin can act on ─────────────────────────────────

function errMessage(e: unknown): string {
  return String((e as { message?: unknown })?.message ?? e ?? "")
}

function aiFailure(e: unknown, model: string): { error: string; status: number } | null {
  const provider = providerOf(model)
  const msg = errMessage(e)

  if (e instanceof AiNotConfiguredError) {
    return {
      error: `The AI model set for "${SLOT_LABEL}" (${model}) isn't set up on this server (${msg}). Pick a different model for it in Admin → AI Models.`,
      status: 500,
    }
  }
  if (e instanceof AiBlockedError) {
    // ⚠ MALFORMED_FUNCTION_CALL is the model fumbling its own answer, not a refusal — it is
    // thrown worded like a block, but it is stochastic and usually clears on the next press
    // (RULES "A leaked tool call is NOT a description"). Never report it as "content blocked".
    if (/MALFORMED_FUNCTION_CALL|UNEXPECTED_TOOL_CALL/i.test(msg)) {
      return { error: "The AI got its answer in a muddle — press Suggest again.", status: 502 }
    }
    // ⚠ Claude's EMPTY answer (and its "ran out of room") is also thrown as AiBlockedError by
    // lib/ai-provider.ts, but it is not a refusal either. Reported as a block it told Jordan to
    // "reword the focus" for what is really just "press again".
    if (/empty response|ran out of room/i.test(msg)) {
      return { error: "The AI came back with nothing — press Suggest again.", status: 502 }
    }
    // A genuine content block will never succeed on retry — 422, not 500 (RULES).
    return { error: `The AI wouldn't write these questions (${msg}). Try rewording the focus, or leave it blank.`, status: 422 }
  }
  if (isRateLimitError(e)) {
    return provider === "gemini"
      ? {
          // ⚠ Say the real reason: the whole Google project gets 4 requests a minute, shared with
          // everything else in the Hub using AI at that moment — pressing again at once won't help.
          error: "Google's AI is busy — the Hub's whole Google account is only allowed 4 AI requests a minute, shared with everything else using AI right now. Wait a minute, then press Suggest again.",
          status: 429,
        }
      : { error: "Claude is rate-limited right now (too many requests in a short time). Wait a minute, then press Suggest again.", status: 429 }
  }
  if (provider === "anthropic" && /credit balance|billing/i.test(msg)) {
    return {
      error: `The Anthropic (Claude) account has run out of credit. Top it up, or set "${SLOT_LABEL}" to a Gemini model in Admin → AI Models.`,
      status: 500,
    }
  }
  if (geminiErrorKind(e) === "404") {
    return {
      error: `The AI model set for "${SLOT_LABEL}" (${model}) isn't available any more. Pick another one in Admin → AI Models.`,
      status: 500,
    }
  }
  // A 503 / overloaded — worded for either provider ("overloaded" matches Claude's 529 too).
  return friendlyGeminiError(e)
}

// ── The route ───────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // Admin-only, judged on the REAL session: this is Jordan's authoring screen, not something a
    // cataloguer's view can reach (same check as app/(app)/admin/page.tsx).
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as { focus?: unknown; count?: unknown; existing?: unknown }

    const n = Math.round(Number(body?.count))
    const count = Number.isFinite(n) && body?.count !== undefined && body?.count !== null && body?.count !== ""
      ? Math.min(MAX_COUNT, Math.max(1, n))
      : DEFAULT_COUNT

    const focus = typeof body?.focus === "string" ? clip(body.focus, MAX_FOCUS_CHARS) : ""

    const existing = (Array.isArray(body?.existing) ? body.existing : [])
      .filter((q): q is string => typeof q === "string")
      .map(q => clip(q, MAX_QUESTION_CHARS))
      .filter(Boolean)
      .slice(0, MAX_QUESTIONS)

    // Decided in code, not left to the model's judgement: one feature-request question, only when
    // the survey doesn't already have one. ⚠ Not for a single suggestion — asking for ONE question
    // means the admin wants one specific thing, usually on the focus they typed.
    // ⚠ Unless the admin's own focus IS features ("what new features would help photography?"):
    // every survey starts with the house feature question, so the one-feature rule would otherwise
    // drop every single suggestion he just asked for and blame it on "yes/no or off-topic".
    const focusOnFeatures = !!focus && (FEATURE_FOCUS_RE.test(plain(focus)) || isFeatureQuestion(focus))
    const alreadyHasFeature = !focusOnFeatures && existing.some(isFeatureQuestion)
    const wantFeature = !focusOnFeatures && !alreadyHasFeature && count >= 2

    const prompt = [
      `Write ${count} new question${count === 1 ? "" : "s"} for this survey.`,
      "",
      focus
        ? `WHAT THE ADMIN WANTS THESE QUESTIONS TO FOCUS ON\n${focus}`
        : "No particular focus — spread the questions across the day-to-day cataloguing work.",
      "",
      existing.length
        ? `QUESTIONS THE SURVEY ALREADY HAS — do not repeat or rephrase any of these:\n${existing.map(q => `- ${q}`).join("\n")}`
        : "The survey has no questions yet.",
      "",
      focusOnFeatures
        ? "The admin's focus is on features, so feature-request questions are welcome — but each must ask about something different, and none may repeat one the survey already has."
        : alreadyHasFeature
        ? "The survey already asks what features they would like, so do NOT write a feature-request question."
        : wantFeature
          ? "Make exactly one of your questions — the last one — a feature request: invite them to describe something they would like the Hub to do that it doesn't do yet. The others must not be feature requests."
          : "Do not write a feature-request question.",
      "",
      "Write the JSON now.",
    ].join("\n")

    const model = await getToolModel(SLOT)
    const call = () => generateAiText({
      model,
      system: SYSTEM,
      cachePrefix: HUB_CONTEXT,
      prompt,
      json: true,
      // Roomy for a short answer on purpose: thinking tokens come out of the same budget on both
      // providers, and a tight cap truncates the JSON mid-list — which is then an error, not a list.
      maxOutputTokens: 8192,
    })

    let raw: string
    try {
      const started = Date.now()
      try {
        raw = await call()
      } catch (e) {
        // One retry, and only for a Gemini 503 / overload: RULES says that is transient, not a
        // failure. ⚠ Never retry a RATE LIMIT here — the whole project gets 4 requests a minute, so
        // an instant retry just spends another of them and fails the same way. Claude is not
        // retried here because its SDK already retries overloads itself.
        // ⚠ And not after a SLOW failure (a "deadline exceeded" can take most of a minute): a retry
        // then doubles the wait on a screen that is showing a spinner, and outlives maxDuration.
        if (providerOf(model) !== "gemini" || e instanceof AiBlockedError || e instanceof AiNotConfiguredError
            || isRateLimitError(e) || !isTransientGeminiError(e) || Date.now() - started > 20_000) throw e
        await new Promise(r => setTimeout(r, 2000))
        raw = await call()
      }
    } catch (e) {
      const friendly = aiFailure(e, model)
      if (friendly) {
        console.error(`feedback/suggest AI error (${model}):`, errMessage(e))
        return NextResponse.json({ error: friendly.error }, { status: friendly.status })
      }
      throw e
    }

    // ⚠ A leaked tool call is not an answer, however much of it looks like one (RULES, 2026-09-01):
    // the model stops dead where it went to "search", so whatever came before it is half a reply.
    if (!raw?.trim()) {
      return NextResponse.json({ error: "The AI came back with nothing — press Suggest again." }, { status: 502 })
    }
    // ⚠⚠ Test the reply with its whitespace COLLAPSED, never raw. hasToolCallLeak() reports "leaked"
    // whenever its tidy-up changed the text — and that tidy-up squeezes double spaces and drops
    // lone ``` lines. Pretty-printed JSON is indented with double spaces (Claude always, Gemini
    // often), so the raw test called EVERY such reply a leaked tool call and the button could
    // never work. Collapsed, only the real markers (tool_code, print(google_search…)) are left to find.
    const leakMsg = "The AI wrote out a web search instead of questions — press Suggest again."
    if (hasToolCallLeak(raw.replace(/\s+/g, " "))) {
      return NextResponse.json({ error: leakMsg }, { status: 502 })
    }

    const parsed = parseModelJson(raw)
    const list: unknown[] | null =
      Array.isArray(parsed) ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { questions?: unknown }).questions)
        ? (parsed as { questions: unknown[] }).questions
        : null
    if (!list) {
      // Includes a reply truncated mid-list: it won't parse, and half a list is never shown as the whole.
      return NextResponse.json({ error: "The AI's reply couldn't be read — press Suggest again." }, { status: 502 })
    }

    const cleaned = list.map(tidyQuestion).filter(Boolean)
    // ⚠ A leak in ANY item fails the whole reply, not just that item: the model stops dead where it
    // went to "search", so the list it was writing is unfinished — dropping the one bad item would
    // hand back the rest as though it were the whole answer.
    if (cleaned.some(q => hasToolCallLeak(q))) {
      return NextResponse.json({ error: leakMsg }, { status: 502 })
    }

    const taken: { text: string; words: Set<string> }[] =
      existing.map(q => ({ text: norm(q), words: contentWords(q) }))
    const questions: string[] = []
    const offered = cleaned.length
    let duplicates = 0
    let extraFeatures = 0
    let featureKept = false

    for (const q of cleaned) {
      // ⚠ An over-long question is DROPPED, not cut: a question chopped at 500 characters is half a
      // question presented as a whole one. The prompt asks for under 25 words, so this is rare.
      if (q.length > MAX_QUESTION_CHARS) continue
      const p = plain(q)
      if (YES_NO_RE.test(p) || RATING_RE.test(p) || PERSONAL_RE.test(p)) continue
      // Never a second feature question — not on top of the survey's own, nor two in one batch
      // (unless the admin's focus asked for features).
      const feature = !focusOnFeatures && isFeatureQuestion(q)
      if (feature && (alreadyHasFeature || featureKept)) { extraFeatures++; continue }
      const words = contentWords(q)
      const key = norm(q)
      if (taken.some(t => t.text === key || nearDuplicate(t.words, words))) { duplicates++; continue }
      // ⚠ Only counted once it is actually KEPT — a feature question dropped as a duplicate must not
      // block a different one later in the list.
      if (feature) featureKept = true
      taken.push({ text: key, words })
      questions.push(q)
      if (questions.length >= count) break
    }

    if (questions.length === 0) {
      // Say WHY there is nothing — "no suggestions" must never look like a quiet success.
      const error = offered === 0
        ? "The AI didn't write any questions — press Suggest again."
        : duplicates === offered
          ? "The AI only came up with questions the survey already asks. Try giving it a focus, or press Suggest again."
          : extraFeatures > 0 && extraFeatures + duplicates === offered
            ? "The AI only wrote feature-request questions, and the survey already has one. Try giving it a focus, or press Suggest again."
            : "None of the AI's questions were usable (they were yes/no, ratings, too long, or off-topic) — press Suggest again."
      return NextResponse.json({ error }, { status: 502 })
    }

    return NextResponse.json({ questions })
  } catch (e: unknown) {
    console.error("feedback/suggest error:", e)
    return NextResponse.json({ error: errMessage(e) || "Unknown error" }, { status: 500 })
  }
}

// The look of one slide on the website's hero banner — colours, where the words sit, how big,
// how dark the picture is behind them, and the extras — kept as JSON in HeroSlide.style and set
// in the Banner Manager (Jordan, 2026-09-24: "I need a better banner editor so I can change font
// colours etc"). parseSlideStyle() is the ONE reader: it fills every default and refuses anything
// that is not a colour, one of the choices, or a number in range, so a slide always renders and
// never with a value the site doesn't understand.
//
// 2026-10-14: the slide is drawn as vectis.co.uk draws its banner — the picture full-bleed with a
// white caption card over it (small line, headline, a line of text, a magenta button). The colours
// here are the card's words; the card itself turns navy when the headline colour is light, so a
// slide saved with white words before this change still reads (hero-slide-view.tsx).

export type SlideStyle = {
  /** The small line above the headline ("FEATURED"). */
  kicker: string
  showKicker: boolean
  kickerColor: string
  headlineColor: string
  headlineSize: "s" | "m" | "l"
  subtextColor: string
  buttonBg: string
  buttonText: string
  /** The outlined REGISTER FREE button beside the main one (never shown to a signed-in customer). */
  showRegister: boolean
  /** An optional second button of the slide's own. */
  second: { label: string; href: string } | null
  align: "left" | "center" | "right"
  valign: "top" | "middle" | "bottom"
  textWidth: "narrow" | "medium" | "wide"
  /** 0–100: how much the picture is darkened behind the card on this slide (0 = the picture as it is). */
  shade: number
  /** How long the slide stays before the next one, in seconds. */
  seconds: number
}

// The site's look when a slide has no saved style: vectis.co.uk's own caption card.
export const DEFAULT_STYLE: SlideStyle = {
  kicker: "Featured",
  showKicker: true,
  kickerColor: "#c27608",
  headlineColor: "#000000",
  headlineSize: "m",
  subtextColor: "#000000",
  buttonBg: "#f102f2",
  buttonText: "#ffffff",
  showRegister: false,
  second: null,
  align: "left",
  valign: "middle",
  textWidth: "medium",
  shade: 0,
  seconds: 5,
}

// The swatches the editor offers first; any other colour can be typed or picked.
export const BRAND_COLOURS: { hex: string; name: string }[] = [
  { hex: "#000000", name: "Black" },
  { hex: "#212529", name: "Ink" },
  { hex: "#6c757d", name: "Grey" },
  { hex: "#ffffff", name: "White" },
  { hex: "#2e328e", name: "Vectis navy" },
  { hex: "#ff0300", name: "Vectis red" },
  { hex: "#f102f2", name: "Magenta" },
  { hex: "#c27608", name: "Orange" },
  { hex: "#f5c518", name: "Gold" },
]

export const HEX_COLOUR = /^#[0-9a-f]{6}$/i

const colour = (v: unknown, dflt: string) => (typeof v === "string" && HEX_COLOUR.test(v.trim()) ? v.trim().toLowerCase() : dflt)
const choice = <T extends string>(v: unknown, list: readonly T[], dflt: T): T => ((list as readonly string[]).includes(String(v)) ? (v as T) : dflt)
const num = (v: unknown, lo: number, hi: number, dflt: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt }
const text = (v: unknown, max: number, dflt: string) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : dflt)
const link = (v: unknown) => (typeof v === "string" && /^(\/|https?:\/\/)/.test(v.trim()) ? v.trim().slice(0, 300) : null)

export function parseSlideStyle(v: unknown): SlideStyle {
  const o = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>
  const sec = o.second && typeof o.second === "object" ? (o.second as Record<string, unknown>) : null
  const secondLabel = sec ? text(sec.label, 60, "") : ""
  const secondHref = sec ? link(sec.href) : null
  return {
    kicker: text(o.kicker, 80, DEFAULT_STYLE.kicker),
    showKicker: typeof o.showKicker === "boolean" ? o.showKicker : DEFAULT_STYLE.showKicker,
    kickerColor: colour(o.kickerColor, DEFAULT_STYLE.kickerColor),
    headlineColor: colour(o.headlineColor, DEFAULT_STYLE.headlineColor),
    headlineSize: choice(o.headlineSize, ["s", "m", "l"] as const, DEFAULT_STYLE.headlineSize),
    subtextColor: colour(o.subtextColor, DEFAULT_STYLE.subtextColor),
    buttonBg: colour(o.buttonBg, DEFAULT_STYLE.buttonBg),
    buttonText: colour(o.buttonText, DEFAULT_STYLE.buttonText),
    showRegister: typeof o.showRegister === "boolean" ? o.showRegister : DEFAULT_STYLE.showRegister,
    second: secondLabel && secondHref ? { label: secondLabel, href: secondHref } : null,
    align: choice(o.align, ["left", "center", "right"] as const, DEFAULT_STYLE.align),
    valign: choice(o.valign, ["top", "middle", "bottom"] as const, DEFAULT_STYLE.valign),
    textWidth: choice(o.textWidth, ["narrow", "medium", "wide"] as const, DEFAULT_STYLE.textWidth),
    shade: num(o.shade, 0, 100, DEFAULT_STYLE.shade),
    seconds: num(o.seconds, 3, 20, DEFAULT_STYLE.seconds),
  }
}

import type { CSSProperties, ReactNode } from "react"
import Link from "next/link"
import type { ComponentConfig, Slot } from "@puckeditor/core"
import { ColourFieldUI, PictureFieldUI } from "./fields-ui"
import { barlow } from "../site-font"
import {
  ALIGN_OPTIONS, BRAND, FLEX_JUSTIFY, PADDING_ALL, PADDING_OPTIONS, PADDING_Y, SELF_ALIGN, TEXT_ALIGN, TONE_VARS,
  WIDTH_CLASS, WIDTH_OPTIONS, YES_NO, colourOr, isDark, linkKind, lines, pictureSrc, safeHtml, videoEmbed,
} from "./look"

// The page editor's building blocks (Website → Pages) — the ones that hold their own words and
// pictures. The blocks that show the Hub's live data (upcoming sales, news, a department's lots…)
// are in live-defs.ts. ONE rendering of each block, used by the site AND by the editor's canvas,
// so what the editor shows is what the site shows (the rule the banner editor set).
//
// ⚠ Keep every render here PURE — no hooks, no event handlers: the site renders them as server
// components. Anything interactive is plain HTML (the accordion is <details>). Colours the author
// picks are inline styles; every class is written out in full so Tailwind can find it.
//
// The blocks draw in the site's own vocabulary (site.css: vs-h1…vs-h4, vs-btn, vs-card-flat,
// vs-kicker…) so a page built here sits beside the built-in pages without a join showing.
// Words take their colours from CSS variables (TONE_VARS in look.ts): a Section or Box on a dark
// background sets the light set, so a heading dropped into it turns white on its own. A colour
// picked on the block itself always wins.

const colour = (label: string) => ({ type: "custom" as const, label, render: ColourFieldUI })
const picture = (label = "Picture") => ({ type: "custom" as const, label, render: PictureFieldUI })

// ── Small shared pieces ─────────────────────────────────────────────────────

function Anchor({ href, className, style, newTab, children }: { href: string; className?: string; style?: CSSProperties; newTab?: boolean; children: ReactNode }) {
  const kind = linkKind(href)
  if (kind === "internal") return <Link href={href} className={className} style={style}>{children}</Link>
  if (kind === "anchor" || kind === "external") {
    const outside = kind === "external" && /^https?:/i.test(href)
    return <a href={href} className={className} style={style} {...(outside && newTab !== false ? { target: "_blank", rel: "noreferrer" } : {})}>{children}</a>
  }
  return <span className={className} style={style}>{children}</span>
}

const toneStyle = (dark: boolean) => (dark ? TONE_VARS.dark : TONE_VARS.light) as unknown as CSSProperties
const anchorId = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "")

// The short bar under a title (site.css's vs-rule, 30 × 3) — drawn as its own element so it can
// sit under a centred or right-aligned heading and turn white on a dark background.
const Rule = ({ align, red }: { align: string; red?: boolean }) => (
  <div aria-hidden="true" className={`h-[3px] w-[30px] mt-[14px] ${SELF_ALIGN[align] ?? ""}`} style={{ background: red ? "var(--pe-kicker)" : "var(--pe-rule)" }} />
)

// Placeholders are shown in the editor only — an empty block on the site shows nothing.
function Empty({ editing, children }: { editing: boolean; children: ReactNode }) {
  return editing
    ? <div className="w-full border-2 border-dashed py-8 px-4 text-center text-sm" style={{ borderColor: "var(--pe-line)", color: "var(--pe-muted)", background: "rgba(0,0,0,0.03)" }}>{children}</div>
    : <div className="hidden" />
}

const ICONS: Record<string, string> = {
  badge: "M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z",
  globe: "M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  coin: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  phone: "M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z",
  mail: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
  truck: "M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0",
  star: "M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z",
  calendar: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  camera: "M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9zM15 13a3 3 0 11-6 0 3 3 0 016 0z",
}
const ICON_OPTIONS = [{ label: "None", value: "" }, ...Object.keys(ICONS).map(k => ({ label: k[0].toUpperCase() + k.slice(1), value: k }))]

// ═════════════════════════════════════════════════════════════════════════════
// Layout
// ═════════════════════════════════════════════════════════════════════════════

export type SectionProps = {
  background: string; picture: string; darken: number; tone: "auto" | "light" | "dark"
  width: string; paddingY: string; anchor: string; content: Slot
}
export const Section: ComponentConfig<SectionProps> = {
  label: "Section",
  fields: {
    content: { type: "slot" },
    background: colour("Background colour"),
    picture: picture("Background picture (optional)"),
    darken: { type: "number", label: "Darken the picture (0–90%)", min: 0, max: 90, step: 5 },
    tone: { type: "radio", label: "Words", options: [{ label: "Automatic", value: "auto" }, { label: "Dark words", value: "light" }, { label: "Light words", value: "dark" }] },
    width: { type: "select", label: "Width of what's inside", options: WIDTH_OPTIONS },
    paddingY: { type: "select", label: "Space above and below", options: PADDING_OPTIONS },
    anchor: { type: "text", label: "Link name (so a button can jump here with #name)" },
  },
  defaultProps: { background: "", picture: "", darken: 0, tone: "auto", width: "standard", paddingY: "medium", anchor: "", content: [] },
  render: ({ background, picture: pic, darken, tone, width, paddingY, anchor, content: Content }) => {
    const bg = colourOr(background)
    const src = pictureSrc(pic)
    const shade = Math.min(90, Math.max(0, Number(darken) || 0))
    const dark = tone === "dark" || (tone === "auto" && ((!!src && shade >= 35) || isDark(bg)))
    // "Automatic" with nothing behind it keeps the colours of whatever it sits in.
    const vars = tone === "auto" && !bg && !src ? {} : toneStyle(dark)
    return (
      <section id={anchorId(anchor) || undefined} className="relative overflow-hidden scroll-mt-24" style={{ backgroundColor: bg || undefined, ...vars }}>
        {src && <img src={src} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />}
        {src && shade > 0 && <div className="absolute inset-0 bg-black" style={{ opacity: shade / 100 }} />}
        <Content className={`relative flex flex-col gap-6 ${WIDTH_CLASS[width] ?? WIDTH_CLASS.standard} ${PADDING_Y[paddingY] ?? PADDING_Y.medium}`} />
      </section>
    )
  },
}

const COLUMN_LAYOUTS: Record<string, { n: number; cls: string; label: string }> = {
  "1-1": { n: 2, cls: "lg:grid-cols-2", label: "Two equal" },
  "2-1": { n: 2, cls: "lg:grid-cols-[2fr_1fr]", label: "Wide left, narrow right" },
  "1-2": { n: 2, cls: "lg:grid-cols-[1fr_2fr]", label: "Narrow left, wide right" },
  "3-1": { n: 2, cls: "lg:grid-cols-[3fr_1fr]", label: "Three-quarters left" },
  "1-3": { n: 2, cls: "lg:grid-cols-[1fr_3fr]", label: "Three-quarters right" },
  "1-1-1": { n: 3, cls: "md:grid-cols-3", label: "Three equal" },
  "1-1-1-1": { n: 4, cls: "sm:grid-cols-2 lg:grid-cols-4", label: "Four equal" },
}
const GAP: Record<string, string> = { small: "gap-4", medium: "gap-8", large: "gap-12" }
const VALIGN: Record<string, string> = { top: "items-start", middle: "items-center", bottom: "items-end", stretch: "items-stretch" }

export type ColumnsProps = { layout: string; gap: string; valign: string; col1: Slot; col2: Slot; col3: Slot; col4: Slot }
export const Columns: ComponentConfig<ColumnsProps> = {
  label: "Columns",
  fields: {
    layout: { type: "select", label: "Columns", options: Object.entries(COLUMN_LAYOUTS).map(([value, l]) => ({ value, label: l.label })) },
    gap: { type: "radio", label: "Space between", options: [{ label: "Small", value: "small" }, { label: "Medium", value: "medium" }, { label: "Large", value: "large" }] },
    valign: { type: "select", label: "Line up", options: [{ label: "At the top", value: "top" }, { label: "In the middle", value: "middle" }, { label: "At the bottom", value: "bottom" }, { label: "Same height", value: "stretch" }] },
    col1: { type: "slot" }, col2: { type: "slot" }, col3: { type: "slot" }, col4: { type: "slot" },
  },
  defaultProps: { layout: "1-1", gap: "medium", valign: "top", col1: [], col2: [], col3: [], col4: [] },
  render: ({ layout, gap, valign, col1: One, col2: Two, col3: Three, col4: Four }) => {
    const l = COLUMN_LAYOUTS[layout] ?? COLUMN_LAYOUTS["1-1"]
    const cell = "flex flex-col gap-5 min-w-0"
    return (
      <div className={`grid grid-cols-1 ${l.cls} ${GAP[gap] ?? GAP.medium} ${VALIGN[valign] ?? VALIGN.top}`}>
        <One className={cell} />
        <Two className={cell} />
        {l.n >= 3 && <Three className={cell} />}
        {l.n >= 4 && <Four className={cell} />}
      </div>
    )
  },
}

// ⚠ The keys are what saved pages hold — only the look behind them changes.
const BORDERS: Record<string, string> = { none: "", light: "border border-[var(--vs-line)]", strong: "border-2 border-[var(--vs-navy)]", left: "border-l-4 border-[var(--vs-red)]" }

export type BoxProps = { background: string; border: string; padding: string; tone: "auto" | "light" | "dark"; shadow: boolean; anchor: string; content: Slot }
export const Box: ComponentConfig<BoxProps> = {
  label: "Box",
  fields: {
    content: { type: "slot" },
    background: colour("Background colour"),
    border: { type: "select", label: "Border", options: [{ label: "None", value: "none" }, { label: "Light", value: "light" }, { label: "Strong navy", value: "strong" }, { label: "Red bar on the left", value: "left" }] },
    padding: { type: "select", label: "Space inside", options: PADDING_OPTIONS },
    tone: { type: "radio", label: "Words", options: [{ label: "Automatic", value: "auto" }, { label: "Dark words", value: "light" }, { label: "Light words", value: "dark" }] },
    shadow: { type: "radio", label: "Shadow", options: YES_NO },
    anchor: { type: "text", label: "Link name (#name)" },
  },
  defaultProps: { background: "#ffffff", border: "light", padding: "medium", tone: "auto", shadow: false, anchor: "", content: [] },
  render: ({ background, border, padding, tone, shadow, anchor, content: Content }) => {
    const bg = colourOr(background)
    const dark = tone === "dark" || (tone === "auto" && isDark(bg))
    // "Automatic" with no background of its own keeps the colours of whatever it sits in — a
    // see-through box in a navy section must not turn its words dark (as the Section rule above).
    const vars = tone === "auto" && !bg ? {} : toneStyle(dark)
    return (
      <div id={anchorId(anchor) || undefined} className={`scroll-mt-24 ${BORDERS[border] ?? ""} ${PADDING_ALL[padding] ?? PADDING_ALL.medium} ${shadow ? "shadow-[var(--vs-shadow)]" : ""}`} style={{ backgroundColor: bg || undefined, ...vars }}>
        <Content className="flex flex-col gap-4" />
      </div>
    )
  },
}

const SPACE: Record<string, number> = { xs: 8, s: 16, m: 32, l: 64, xl: 96 }
export const Spacer: ComponentConfig<{ size: string }> = {
  label: "Space",
  fields: { size: { type: "radio", label: "Height", options: [{ label: "XS", value: "xs" }, { label: "S", value: "s" }, { label: "M", value: "m" }, { label: "L", value: "l" }, { label: "XL", value: "xl" }] } },
  defaultProps: { size: "m" },
  render: ({ size }) => <div aria-hidden="true" style={{ height: SPACE[size] ?? 32 }} />,
}

export const Divider: ComponentConfig<{ style: string; align: string }> = {
  label: "Line",
  fields: {
    style: { type: "select", label: "Kind", options: [{ label: "Short red bar", value: "red" }, { label: "Short navy bar", value: "blue" }, { label: "Thin line across", value: "line" }] },
    align: { type: "radio", label: "Position", options: ALIGN_OPTIONS },
  },
  defaultProps: { style: "line", align: "left" },
  render: ({ style, align }) =>
    style === "line"
      ? <hr className="w-full border-0 h-px" style={{ background: "var(--pe-line)" }} />
      : <div aria-hidden="true" className={`h-[3px] w-[30px] ${SELF_ALIGN[align] ?? ""}`} style={{ background: style === "blue" ? "var(--pe-rule)" : "var(--pe-kicker)" }} />,
}

// ═════════════════════════════════════════════════════════════════════════════
// Words and pictures
// ═════════════════════════════════════════════════════════════════════════════

// The level gives the heading its site class (vs-h1…vs-h4) and its meaning; the size can then
// override it, in the site's own steps: xl = page title (vs-h1), l = section title (vs-h2),
// m = vs-h3, s = vs-h4, xs = the small sub-heading of a text page ("BID ONLINE"). The level's own
// size needs no override, so a plain H2 is exactly the site's vs-h2.
const HEADING_CLASS: Record<string, string> = { h1: "vs-h1", h2: "vs-h2", h3: "vs-h3", h4: "vs-h4" }
const HEADING_NATURAL: Record<string, string> = { h1: "xl", h2: "l", h3: "m", h4: "s" }
const HEADING_SIZE: Record<string, string> = {
  xs: "!text-base !font-semibold !leading-snug",
  s: "!text-xl !font-medium !leading-tight",
  m: "!text-2xl !font-normal !leading-tight",
  l: "!text-[clamp(28px,3.2vw,36px)] !font-semibold !leading-[1.15]",
  xl: "!text-[clamp(32px,4.2vw,48px)] !font-normal !leading-[1.05]",
}

export type HeadingProps = { kicker: string; text: string; level: string; size: string; colour: string; align: string; uppercase: boolean; rule: string }
export const Heading: ComponentConfig<HeadingProps> = {
  label: "Heading",
  fields: {
    text: { type: "text", label: "Heading", contentEditable: true },
    kicker: { type: "text", label: "Small line above (optional)" },
    level: { type: "select", label: "Level (for search engines — one H1 per page)", options: [{ label: "H1 — the page's title", value: "h1" }, { label: "H2 — a section", value: "h2" }, { label: "H3 — a sub-section", value: "h3" }, { label: "H4", value: "h4" }] },
    size: { type: "radio", label: "Size", options: [{ label: "XS", value: "xs" }, { label: "S", value: "s" }, { label: "M", value: "m" }, { label: "L", value: "l" }, { label: "XL", value: "xl" }] },
    uppercase: { type: "radio", label: "Capitals", options: YES_NO },
    colour: colour("Colour"),
    align: { type: "radio", label: "Position", options: ALIGN_OPTIONS },
    rule: { type: "select", label: "Bar underneath", options: [{ label: "None", value: "none" }, { label: "Red", value: "red" }, { label: "Navy", value: "blue" }] },
  },
  defaultProps: { kicker: "", text: "A heading", level: "h2", size: "l", colour: "", align: "left", uppercase: false, rule: "none" },
  render: ({ kicker, text, level, size, colour: c, align, uppercase, rule }) => {
    const Tag = (["h1", "h2", "h3", "h4"].includes(level) ? level : "h2") as "h1" | "h2" | "h3" | "h4"
    const sized = size && size !== HEADING_NATURAL[Tag] ? HEADING_SIZE[size] ?? "" : ""
    return (
      <div className={TEXT_ALIGN[align] ?? ""}>
        {kicker && <p className="vs-kicker mb-2" style={{ color: "var(--pe-kicker)" }}>{kicker}</p>}
        <Tag className={`${HEADING_CLASS[Tag]} ${sized} ${uppercase ? "uppercase tracking-[1px]" : ""}`} style={{ color: colourOr(c) || "var(--pe-heading)" }}>{text}</Tag>
        {rule !== "none" && <Rule align={align} red={rule === "red"} />}
      </div>
    )
  },
}

const TEXT_SIZE: Record<string, string> = { s: "text-sm", m: "text-base", l: "text-lg" }

export type TextProps = { text: string; size: string; colour: string; align: string; width: string }
export const Text: ComponentConfig<TextProps> = {
  label: "Text",
  fields: {
    text: { type: "richtext", label: "Text", contentEditable: true },
    size: { type: "radio", label: "Size", options: [{ label: "Small", value: "s" }, { label: "Medium", value: "m" }, { label: "Large", value: "l" }] },
    colour: colour("Colour"),
    align: { type: "radio", label: "Position", options: ALIGN_OPTIONS },
    width: { type: "radio", label: "Width", options: [{ label: "Full", value: "full" }, { label: "Easy reading", value: "reading" }] },
  },
  defaultProps: { text: "<p>Write something here.</p>", size: "m", colour: "", align: "left", width: "full" },
  render: ({ text, size, colour: c, align, width }) => (
    <div className={`pe-text ${TEXT_SIZE[size] ?? TEXT_SIZE.m} ${TEXT_ALIGN[align] ?? ""} ${width === "reading" ? `w-full max-w-[760px] ${SELF_ALIGN[align] ?? ""}` : ""}`} style={{ color: colourOr(c) || "var(--pe-text)" }}>
      {text}
    </div>
  ),
}

const ASPECT: Record<string, string> = { auto: "", square: "aspect-square", "4-3": "aspect-[4/3]", "16-9": "aspect-[16/9]", banner: "aspect-[3/1]" }
const MAX_W: Record<string, string> = { full: "", large: "max-w-4xl", medium: "max-w-xl", small: "max-w-xs" }

export type PictureProps = { src: string; alt: string; aspect: string; fit: string; width: string; align: string; link: string; caption: string; frame: boolean }
export const Picture: ComponentConfig<PictureProps> = {
  label: "Picture",
  fields: {
    src: picture("Picture"),
    alt: { type: "text", label: "What it shows (for search engines and screen readers)" },
    aspect: { type: "select", label: "Shape", options: [{ label: "As the picture is", value: "auto" }, { label: "Square", value: "square" }, { label: "4 × 3", value: "4-3" }, { label: "16 × 9 (wide)", value: "16-9" }, { label: "Banner (3 × 1)", value: "banner" }] },
    fit: { type: "radio", label: "In that shape", options: [{ label: "Fill (may trim the edges)", value: "cover" }, { label: "Whole picture", value: "contain" }] },
    width: { type: "select", label: "Size", options: [{ label: "Full width", value: "full" }, { label: "Large", value: "large" }, { label: "Medium", value: "medium" }, { label: "Small", value: "small" }] },
    align: { type: "radio", label: "Position", options: ALIGN_OPTIONS },
    link: { type: "text", label: "Link when clicked (optional — /page or https://…)" },
    caption: { type: "text", label: "Caption (optional)" },
    frame: { type: "radio", label: "Border", options: YES_NO },
  },
  defaultProps: { src: "", alt: "", aspect: "auto", fit: "cover", width: "full", align: "center", link: "", caption: "", frame: false },
  render: ({ src, alt, aspect, fit, width, align, link, caption, frame, puck }) => {
    const s = pictureSrc(src)
    if (!s) return <Empty editing={puck.isEditing}>Choose a picture</Empty>
    const box = ASPECT[aspect] ?? ""
    const img = box ? (
      <div className={`relative w-full ${box} overflow-hidden bg-black/[0.04]`}>
        <img src={s} alt={alt} loading="lazy" className={`absolute inset-0 w-full h-full ${fit === "contain" ? "object-contain" : "object-cover"}`} />
      </div>
    ) : (
      <img src={s} alt={alt} loading="lazy" className="block w-full h-auto" />
    )
    return (
      <figure className={`w-full ${MAX_W[width] ?? ""} ${SELF_ALIGN[align] ?? ""}`}>
        <div className={frame ? "border p-1 bg-white" : ""} style={frame ? { borderColor: "var(--pe-line)" } : undefined}>
          {link ? <Anchor href={link}>{img}</Anchor> : img}
        </div>
        {caption && <figcaption className="text-sm mt-2" style={{ color: "var(--pe-muted)" }}>{caption}</figcaption>}
      </figure>
    )
  },
}

// ⚠ The keys are what saved pages hold ("blue" is the navy button, "chip" the small one).
const BUTTON_STYLE: Record<string, string> = {
  red: "vs-btn vs-btn-red",
  blue: "vs-btn",
  white: "vs-btn vs-btn-white",
  outline: "vs-btn vs-btn-outline",
  outlineLight: "vs-btn vs-btn-white",
  chip: "vs-btn vs-btn-sm",
  link: "vs-link",
}
const BUTTON_SIZE: Record<string, string> = { s: "vs-btn-sm", m: "", l: "vs-btn-lg" }

export type ButtonsProps = { buttons: { label: string; link: string; style: string; newTab: boolean }[]; align: string; size: string }
export const Buttons: ComponentConfig<ButtonsProps> = {
  label: "Buttons",
  fields: {
    buttons: {
      type: "array",
      label: "Buttons",
      arrayFields: {
        label: { type: "text", label: "Words" },
        link: { type: "text", label: "Goes to (/page, #name, https://…, mailto: or tel:)" },
        style: { type: "select", label: "Look", options: [{ label: "Red", value: "red" }, { label: "Navy", value: "blue" }, { label: "White", value: "white" }, { label: "Navy outline", value: "outline" }, { label: "White (on dark)", value: "outlineLight" }, { label: "Small tag (like a filter)", value: "chip" }, { label: "Plain link with a chevron", value: "link" }] },
        newTab: { type: "radio", label: "Other websites open in a new tab", options: YES_NO },
      },
      defaultItemProps: { label: "Find out more", link: "/", style: "blue", newTab: true },
      getItemSummary: item => item.label || "Button",
    },
    align: { type: "radio", label: "Position", options: ALIGN_OPTIONS },
    size: { type: "radio", label: "Size", options: [{ label: "S", value: "s" }, { label: "M", value: "m" }, { label: "L", value: "l" }] },
  },
  defaultProps: { buttons: [{ label: "Find out more", link: "/", style: "blue", newTab: true }], align: "left", size: "m" },
  render: ({ buttons, align, size }) => (
    <div className={`flex flex-wrap items-center gap-3 ${FLEX_JUSTIFY[align] ?? ""}`}>
      {(buttons ?? []).map((b, i) => {
        const link = b.style === "link"
        return (
          <Anchor
            key={i}
            href={b.link}
            newTab={b.newTab}
            className={`${BUTTON_STYLE[b.style] ?? BUTTON_STYLE.blue} ${link ? (size === "s" ? "vs-link-sm" : "") : b.style === "chip" ? "" : BUTTON_SIZE[size] ?? ""}`}
            // A plain link follows the words around it (navy on white, white on navy); buttons carry their own colours.
            style={link ? { color: "var(--pe-link)" } : undefined}
          >
            {b.label}
          </Anchor>
        )
      })}
    </div>
  ),
}

export const Video: ComponentConfig<{ url: string; caption: string; width: string }> = {
  label: "Video",
  fields: {
    url: { type: "text", label: "YouTube or Vimeo address (or an .mp4)" },
    caption: { type: "text", label: "Caption (optional)" },
    width: { type: "select", label: "Size", options: [{ label: "Full width", value: "full" }, { label: "Large", value: "large" }, { label: "Medium", value: "medium" }] },
  },
  defaultProps: { url: "", caption: "", width: "full" },
  render: ({ url, caption, width, puck }) => {
    const v = videoEmbed(url)
    if (!v) return <Empty editing={puck.isEditing}>Paste a YouTube or Vimeo address</Empty>
    // In the editor the player must not swallow the click that selects the block.
    const pe: CSSProperties = puck.isEditing ? { pointerEvents: "none" } : {}
    return (
      <figure className={`w-full ${MAX_W[width] ?? ""}`}>
        <div className="relative w-full aspect-video bg-black">
          {v.kind === "iframe"
            ? <iframe src={v.src} title={caption || "Video"} className="absolute inset-0 w-full h-full border-0" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen loading="lazy" style={pe} />
            : <video src={v.src} controls className="absolute inset-0 w-full h-full" style={pe} />}
        </div>
        {caption && <figcaption className="text-sm mt-2" style={{ color: "var(--pe-muted)" }}>{caption}</figcaption>}
      </figure>
    )
  },
}

// A fold-out exactly as the FAQ page draws one: a navy 18px question, a chevron that turns when it
// opens, the answer underneath — native <details>, so it works with no JavaScript.
export type AccordionProps = { items: { title: string; body: string }[]; style: string; openFirst: boolean }
export const Accordion: ComponentConfig<AccordionProps> = {
  label: "Fold-outs",
  fields: {
    items: {
      type: "array",
      label: "Fold-outs",
      arrayFields: {
        title: { type: "text", label: "Question / title" },
        body: { type: "richtext", label: "Answer" },
      },
      defaultItemProps: { title: "A question", body: "<p>The answer.</p>" },
      getItemSummary: item => item.title || "Fold-out",
    },
    style: { type: "radio", label: "Look", options: [{ label: "Lines", value: "lines" }, { label: "Boxes", value: "boxes" }] },
    openFirst: { type: "radio", label: "First one open", options: YES_NO },
  },
  defaultProps: { items: [{ title: "A question", body: "<p>The answer.</p>" }], style: "lines", openFirst: false },
  render: ({ items, style, openFirst }) => {
    const boxes = style === "boxes"
    return (
      <div className={boxes ? "flex flex-col gap-3" : "border-t"} style={boxes ? undefined : { borderColor: "var(--pe-line)" }}>
        {(items ?? []).map((it, i) => (
          <details
            key={i}
            open={openFirst && i === 0 ? true : undefined}
            className={`group ${boxes ? "border px-5" : "border-b"}`}
            style={{ borderColor: "var(--pe-line)" }}
          >
            <summary className="flex items-center justify-between gap-4 cursor-pointer list-none py-4 text-lg font-medium leading-snug" style={{ color: "var(--pe-link)" }}>
              <span>{it.title}</span>
              <svg className="w-5 h-5 shrink-0 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
            </summary>
            <div className="pe-text text-base pb-5 pr-0 sm:pr-9" style={{ color: "var(--pe-text)" }}>{it.body}</div>
          </details>
        ))}
      </div>
    )
  },
}

export type TableProps = { rows: string; header: boolean; style: string; lastRight: boolean }
export const Table: ComponentConfig<TableProps> = {
  label: "Table",
  fields: {
    rows: { type: "textarea", label: "One row per line, cells split with | (e.g. £5 - £50 | £5)" },
    header: { type: "radio", label: "First row is the heading", options: YES_NO },
    style: { type: "radio", label: "Look", options: [{ label: "Plain", value: "plain" }, { label: "Lined", value: "lined" }, { label: "Striped", value: "striped" }] },
    lastRight: { type: "radio", label: "Last column to the right", options: YES_NO },
  },
  defaultProps: { rows: "Heading | Heading\nCell | Cell", header: true, style: "lined", lastRight: false },
  render: ({ rows, header, style, lastRight }) => {
    const data = lines(rows).map(r => r.split("|").map(c => c.trim()))
    const head = header ? data[0] : null
    const body = header ? data.slice(1) : data
    // "Lined" and "Striped" are the site's running-copy table (every cell a hairline box, the heading
    // row shaded); "Plain" keeps only the row lines.
    const boxed = style !== "plain"
    const cellCls = (j: number, n: number) => `px-3 py-2 align-top ${boxed ? "border" : ""} ${lastRight && j === n - 1 ? "text-right" : "text-left"}`
    const line = { borderColor: "var(--pe-line)" }
    return (
      <div className="w-full overflow-x-auto">
        <table className="w-full text-base border-collapse" style={{ color: "var(--pe-text)" }}>
          {head && (
            <thead>
              <tr className={boxed ? "bg-black/[0.04]" : "border-b-2"} style={line}>
                {head.map((c, j) => <th key={j} scope="col" className={`${cellCls(j, head.length)} font-bold`} style={{ ...line, color: "var(--pe-heading)" }}>{c}</th>)}
              </tr>
            </thead>
          )}
          <tbody>
            {body.map((r, i) => (
              <tr key={i} className={`${boxed ? "" : "border-b last:border-0"} ${style === "striped" && i % 2 === 1 ? "bg-black/[0.025]" : ""}`} style={line}>
                {r.map((c, j) => <td key={j} className={cellCls(j, r.length)} style={line}>{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  },
}

const CARD_COLS: Record<string, string> = { "2": "sm:grid-cols-2", "3": "sm:grid-cols-2 lg:grid-cols-3", "4": "sm:grid-cols-2 lg:grid-cols-4" }

export type CardsProps = {
  columns: string; style: string; align: string; caps: boolean
  items: { icon: string; emoji: string; kicker: string; title: string; text: string; link: string; linkLabel: string }[]
}
export const Cards: ComponentConfig<CardsProps> = {
  label: "Cards",
  fields: {
    items: {
      type: "array",
      label: "Cards",
      arrayFields: {
        icon: { type: "select", label: "Icon", options: ICON_OPTIONS },
        emoji: { type: "text", label: "…or an emoji instead" },
        kicker: { type: "text", label: "Small line above (optional)" },
        title: { type: "text", label: "Title" },
        text: { type: "textarea", label: "Text" },
        link: { type: "text", label: "Link (optional — the whole card clicks through)" },
        linkLabel: { type: "text", label: "Link words (optional)" },
      },
      defaultItemProps: { icon: "star", emoji: "", kicker: "", title: "A point", text: "A sentence or two about it.", link: "", linkLabel: "" },
      getItemSummary: item => item.title || "Card",
    },
    columns: { type: "radio", label: "Across", options: [{ label: "2", value: "2" }, { label: "3", value: "3" }, { label: "4", value: "4" }] },
    style: { type: "radio", label: "Look", options: [{ label: "Plain, round icon", value: "plain" }, { label: "Bordered", value: "bordered" }, { label: "Shaded", value: "shaded" }] },
    align: { type: "radio", label: "Words", options: [{ label: "Left", value: "left" }, { label: "Centre", value: "center" }] },
    caps: { type: "radio", label: "Titles in capitals", options: YES_NO },
  },
  defaultProps: { items: [], columns: "3", style: "plain", align: "center", caps: false },
  render: ({ items, columns, style, align, caps }) => (
    <div className={`grid grid-cols-1 ${CARD_COLS[columns] ?? CARD_COLS["3"]} gap-6`}>
      {(items ?? []).map((it, i) => {
        // A bordered card is the site's white vs-card-flat, so its words are always the dark set
        // whatever the card sits on; the other two looks follow the section around them.
        const bordered = style === "bordered"
        const card = (
          <div
            className={`h-full ${align === "center" ? "text-center" : "text-left"} ${bordered ? "vs-card-flat p-6" : style === "shaded" ? "p-6 bg-black/[0.04]" : ""}`}
            style={bordered ? toneStyle(false) : undefined}
          >
            {(it.icon || it.emoji) && (
              <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-5 ${align === "center" ? "mx-auto" : ""}`} style={{ background: "rgba(0,0,0,0.05)", color: "var(--pe-link)" }}>
                {it.icon && ICONS[it.icon]
                  ? <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={ICONS[it.icon]} /></svg>
                  : <span className="text-3xl leading-none">{it.emoji}</span>}
              </div>
            )}
            {it.kicker && <p className="vs-kicker mb-2" style={{ color: "var(--pe-kicker)" }}>{it.kicker}</p>}
            {it.title && <h3 className={`vs-h4 mb-2 break-words ${caps ? "uppercase tracking-[1px] !text-base !font-semibold" : ""}`} style={{ color: "var(--pe-heading)" }}>{it.title}</h3>}
            {it.text && <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: "var(--pe-muted)" }}>{it.text}</p>}
            {it.link && it.linkLabel && <span className="vs-link vs-link-sm mt-4" style={{ color: "var(--pe-link)" }}>{it.linkLabel}</span>}
          </div>
        )
        return it.link ? <Anchor key={i} href={it.link} className="block h-full group">{card}</Anchor> : <div key={i}>{card}</div>
      })}
    </div>
  ),
}

export const Quote: ComponentConfig<{ text: string; by: string }> = {
  label: "Quote",
  fields: {
    text: { type: "textarea", label: "Quote" },
    by: { type: "text", label: "Who said it (optional)" },
  },
  defaultProps: { text: "A quotation.", by: "" },
  render: ({ text, by }) => (
    <blockquote className="border-l-[3px] pl-6 py-1" style={{ borderColor: "var(--pe-rule)" }}>
      <p className="vs-h3" style={{ color: "var(--pe-heading)" }}>&ldquo;{text}&rdquo;</p>
      {by && <footer className="vs-caps mt-3" style={{ color: "var(--pe-muted)" }}>— {by}</footer>}
    </blockquote>
  ),
}

export type JobProps = {
  title: string; salary: string; type: string; hours: string; description: string
  responsibilities: string; essential: string; desirable: string; benefits: string; applyEmail: string
}
export const Job: ComponentConfig<JobProps> = {
  label: "Job vacancy",
  fields: {
    title: { type: "text", label: "Job title" },
    salary: { type: "text", label: "Pay" },
    type: { type: "text", label: "Kind (e.g. Permanent, Full-time)" },
    hours: { type: "text", label: "Hours (optional)" },
    description: { type: "textarea", label: "About the job" },
    responsibilities: { type: "textarea", label: "Key responsibilities — one per line" },
    essential: { type: "textarea", label: "Essential — one per line" },
    desirable: { type: "textarea", label: "Desirable — one per line" },
    benefits: { type: "textarea", label: "Benefits — one per line" },
    applyEmail: { type: "text", label: "Apply by email to" },
  },
  defaultProps: { title: "Job title", salary: "", type: "Permanent, Full-time", hours: "", description: "", responsibilities: "", essential: "", desirable: "", benefits: "", applyEmail: "admin@vectis.co.uk" },
  render: p => {
    // A white vs-card-flat whatever it sits on, so it keeps the dark words and the site's own vars.
    const part = (heading: string, items: string[]) => items.length > 0 && (
      <div>
        <h4 className="vs-caps mb-2">{heading}</h4>
        <ul className="list-disc ml-5 space-y-1 text-[15px] leading-relaxed text-[var(--vs-ink)]">
          {items.map((r, j) => <li key={j}>{r}</li>)}
        </ul>
      </div>
    )
    const resp = lines(p.responsibilities), ess = lines(p.essential), des = lines(p.desirable), ben = lines(p.benefits)
    const facts = [p.type, p.hours].filter(Boolean).join(" · ")
    return (
      <article className="vs-card-flat" style={toneStyle(false)}>
        <div className="px-6 py-5 border-b border-[var(--vs-line)] flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <h3 className="vs-h4">{p.title}</h3>
            {facts && <p className="vs-caps text-xs text-[var(--vs-muted)] mt-2">{facts}</p>}
          </div>
          {p.salary && <p className="vs-price sm:text-right">{p.salary}</p>}
        </div>
        <div className="px-6 py-6 grid sm:grid-cols-2 gap-6">
          <div className="space-y-5">
            {p.description && <p className="text-base leading-relaxed text-[var(--vs-ink)]">{p.description}</p>}
            {part("Key responsibilities", resp)}
          </div>
          <div className="space-y-5">
            {part("Essential", ess)}
            {part("Desirable", des)}
            {part("Benefits", ben)}
          </div>
        </div>
        {p.applyEmail && (
          <div className="border-t border-[var(--vs-line)] px-6 py-4 flex flex-wrap items-center gap-x-5 gap-y-3">
            <a href={`mailto:${p.applyEmail}?subject=${encodeURIComponent(`Job Application — ${p.title}`)}`} className="vs-btn">Apply</a>
            <span className="text-sm text-[var(--vs-muted)]">Send your CV to {p.applyEmail}</span>
          </div>
        )}
      </article>
    )
  },
}

// "Medium" is the department page's banner on vectis.co.uk (260px, the title over a dark fade).
const HEADER_HEIGHT: Record<string, string> = { auto: "py-12 lg:py-16", small: "min-h-[220px] pt-10 pb-8", medium: "min-h-[260px] pt-12 pb-8", large: "min-h-[420px] pt-16 pb-10" }

export type PageHeaderProps = {
  kicker: string; heading: string; intro: string; background: string; picture: string; darken: number
  height: string; align: string; width: string; crumbs: { label: string; link: string }[]
}
export const PageHeader: ComponentConfig<PageHeaderProps> = {
  label: "Page header",
  fields: {
    heading: { type: "text", label: "Page title (the H1)", contentEditable: true },
    kicker: { type: "text", label: "Small line above (optional)" },
    intro: { type: "textarea", label: "A line or two under the title (optional)" },
    background: colour("Background colour"),
    picture: picture("Background picture (optional)"),
    darken: { type: "number", label: "Darken the picture (0–90%)", min: 0, max: 90, step: 5 },
    height: { type: "select", label: "Height", options: [{ label: "Fit the words", value: "auto" }, { label: "Small", value: "small" }, { label: "Medium", value: "medium" }, { label: "Large", value: "large" }] },
    align: { type: "radio", label: "Words", options: [{ label: "Left", value: "left" }, { label: "Centre", value: "center" }] },
    width: { type: "select", label: "Width of the words", options: WIDTH_OPTIONS },
    crumbs: {
      type: "array",
      label: "Path above the title (optional — e.g. Departments › Dinky)",
      arrayFields: { label: { type: "text", label: "Words" }, link: { type: "text", label: "Link (blank for the current page)" } },
      defaultItemProps: { label: "Home", link: "/" },
      getItemSummary: item => item.label || "Step",
    },
  },
  defaultProps: { kicker: "", heading: "Page title", intro: "", background: BRAND.navy, picture: "", darken: 40, height: "auto", align: "left", width: "text", crumbs: [] },
  render: ({ kicker, heading, intro, background, picture: pic, darken, height, align, width, crumbs }) => {
    const bg = colourOr(background)
    const src = pictureSrc(pic)
    const shade = Math.min(90, Math.max(0, Number(darken) || 0))
    const dark = (!!src && shade >= 25) || isDark(bg) || (!bg && !!src)
    const fixed = height !== "auto"
    const centred = align === "center"
    return (
      <section className="relative overflow-hidden" style={{ backgroundColor: bg || undefined, ...toneStyle(dark) }}>
        {src && <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" />}
        {/* The fade sits at the foot, where the title is, so the words read over any picture. */}
        {src && shade > 0 && <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/25" style={{ opacity: shade / 100 }} />}
        <div className={`relative flex flex-col ${fixed ? "justify-end" : ""} ${HEADER_HEIGHT[height] ?? HEADER_HEIGHT.auto} ${WIDTH_CLASS[width] ?? WIDTH_CLASS.text} ${centred ? "items-center text-center" : ""}`}>
          {(crumbs ?? []).length > 0 && (
            <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 vs-caps text-xs mb-4" style={{ color: "var(--pe-muted)" }}>
              {crumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-2">
                  {i > 0 && <span aria-hidden="true">›</span>}
                  {c.link ? <Anchor href={c.link} className="hover:underline underline-offset-4">{c.label}</Anchor> : <span aria-current="page" style={{ color: "var(--pe-heading)" }}>{c.label}</span>}
                </span>
              ))}
            </nav>
          )}
          {/* Red caption on white, as the site's kickers; orange ("FEATURED") on navy or a picture. */}
          {kicker && <p className={`vs-kicker mb-3 ${dark ? "vs-kicker-orange" : ""}`}>{kicker}</p>}
          <h1 className="vs-h1" style={{ color: "var(--pe-heading)" }}>{heading}</h1>
          {intro && <p className={`vs-lead mt-4 max-w-2xl whitespace-pre-line ${centred ? "mx-auto" : ""}`} style={{ color: "var(--pe-text)" }}>{intro}</p>}
        </div>
      </section>
    )
  },
}

export const Html: ComponentConfig<{ html: string; article: boolean }> = {
  label: "HTML (advanced)",
  fields: {
    html: { type: "textarea", label: "HTML — scripts and click-handlers are removed" },
    article: { type: "radio", label: "Style it like article text", options: YES_NO },
  },
  defaultProps: { html: "<p>HTML goes here.</p>", article: true },
  render: ({ html, article }) => <div className={article ? "pe-text" : ""} style={article ? { color: "var(--pe-text)" } : undefined} dangerouslySetInnerHTML={{ __html: safeHtml(html) }} />,
}

// Every block above, by the name saved in a page's JSON. ⚠ Never rename a key — saved pages
// refer to blocks by it, and a renamed block would vanish from every page that used it.
export const STATIC_BLOCKS = { Section, Columns, Box, Spacer, Divider, PageHeader, Heading, Text, Picture, Buttons, Video, Accordion, Table, Cards, Quote, Job, Html }

// The page as a whole: its name in the Hub, and the title and description search engines show.
export type RootProps = { title: string; seoTitle: string; seoDescription: string; background: string }
export const ROOT_FIELDS = {
  title: { type: "text" as const, label: "Page name (in the Hub's list)" },
  seoTitle: { type: "text" as const, label: "Search-engine title (blank = the page name)" },
  seoDescription: { type: "textarea" as const, label: "Search-engine description — a sentence or two" },
  background: colour("Page background"),
}
export const ROOT_DEFAULTS: RootProps = { title: "", seoTitle: "", seoDescription: "", background: "#ffffff" }

// The site's font variable rides on the root too: on the site it is already on the layout's
// wrapper, but inside the editor's canvas (an iframe) this is the outermost site element.
export function PageRoot({ background, children }: { background?: string; children: ReactNode }) {
  return (
    <div className={`vectis-site ${barlow.variable} pe-page`} style={{ backgroundColor: colourOr(background, "#ffffff"), ...toneStyle(false) }}>
      {children}
    </div>
  )
}

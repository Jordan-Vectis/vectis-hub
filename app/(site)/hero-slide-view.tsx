import Link from "next/link"
import type { CSSProperties, ReactNode } from "react"
import { DEFAULT_STYLE, type SlideStyle } from "./hero-style"

// ONE rendering of a hero slide, used by the site's hero (home-hero.tsx) and by the Banner
// Manager's preview — so what the editor shows is exactly what the site will show. No hooks, no
// state: everything comes from the slide. `preview` swaps the links for plain spans.
//
// The look is vectis.co.uk's banner (2026-10-14): the picture fills the frame and a caption CARD
// sits over it — a small line ("FEATURED"), the headline, a line of text, and a magenta button.
export type SlideData = {
  title: string
  subtitle: string
  cta: string
  ctaHref: string
  /** The picture's address (signed by the page), or null for the navy backdrop. */
  imageUrl?: string | null
  /** Which part of the picture stays when it is cropped to the frame: top / center / bottom. */
  imageFocus?: string | null
  style?: SlideStyle | null
}

// A banner picture is cropped to the frame (object-cover), so a tall picture loses its top or
// bottom — the focus says which part stays (2026-09-24).
export const focusPosition = (f?: string | null) => (f === "top" ? "center top" : f === "bottom" ? "center bottom" : "center center")

/** Relative luminance (sRGB, the WCAG way) — a headline colour under ~0.45 is dark enough for a white card. */
function isLight(hex: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return false
  const n = parseInt(m[1], 16)
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255) >= 0.45
}

const SIZE = { s: "text-[26px] sm:text-[30px]", m: "text-[30px] sm:text-[36px]", l: "text-[34px] sm:text-[44px]" } as const
const WIDTH = { narrow: 380, medium: 440, wide: 560 } as const
// The card sits clear of the dots along the bottom edge.
const VALIGN = { top: "justify-start pt-10", middle: "justify-center", bottom: "justify-end pb-20" } as const
const ALIGN = { left: "items-start", center: "items-center", right: "items-end" } as const
const TEXT_ALIGN = { left: "text-left", center: "text-center", right: "text-right" } as const
const BUTTONS = { left: "justify-start", center: "justify-center", right: "justify-end" } as const

function Btn({ href, preview, className, style, children }: { href: string; preview?: boolean; className: string; style?: CSSProperties; children: ReactNode }) {
  return preview
    ? <span className={className} style={style}>{children}</span>
    : <Link href={href} className={className} style={style}>{children}</Link>
}

export default function SlideView({ slide: s, isLoggedIn, eager, preview }: { slide: SlideData; isLoggedIn: boolean; eager?: boolean; preview?: boolean }) {
  const st = s.style ?? DEFAULT_STYLE
  // A slide saved before 2026-10-14 may carry white words (they sat straight on the picture then);
  // on a white card they would vanish, so the card goes navy for light words and white for dark.
  const darkCard = isLight(st.headlineColor)
  return (
    <>
      {/* Background — the picture as it is, or a navy backdrop when there is none. Nothing is laid
          over the picture unless this slide's own shade says so (Jordan: "remove the filter completely"). */}
      <div className="absolute inset-0 bg-[#2e328e]" />
      {s.imageUrl ? (
        <img
          src={s.imageUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          style={{ objectPosition: focusPosition(s.imageFocus) }}
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : undefined}
        />
      ) : (
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(circle, white 1px, transparent 1px)", backgroundSize: "36px 36px" }} />
      )}
      {st.shade > 0 && <div className="absolute inset-0 bg-black" style={{ opacity: st.shade / 100 }} />}

      <div className={`relative h-full flex flex-col px-5 sm:px-16 ${VALIGN[st.valign]}`}>
        <div className={`flex flex-col w-full ${ALIGN[st.align]}`}>
          <div
            className={`w-full flex flex-col px-6 py-6 sm:px-9 sm:py-8 ${TEXT_ALIGN[st.align]} ${darkCard ? "bg-[#2e328e]" : "bg-white"}`}
            style={{ maxWidth: WIDTH[st.textWidth], boxShadow: "0 10px 30px rgba(0,0,0,0.18)" }}
          >
            {st.showKicker && (
              <p className="vs-kicker mb-3" style={{ color: st.kickerColor }}>{st.kicker}</p>
            )}
            <h2 className={`font-medium leading-[1.05] mb-3 ${SIZE[st.headlineSize]}`} style={{ color: st.headlineColor }}>
              {s.title}
            </h2>
            {s.subtitle && (
              <p className="text-base leading-snug mb-6 uppercase tracking-[0.5px]" style={{ color: st.subtextColor }}>
                {s.subtitle}
              </p>
            )}
            <div className={`flex flex-wrap gap-3 ${BUTTONS[st.align]}`}>
              <Btn href={s.ctaHref} preview={preview} className="vs-btn vs-btn-lg" style={{ background: st.buttonBg, borderColor: st.buttonBg, color: st.buttonText }}>
                {s.cta}
              </Btn>
              {st.second && (
                <Btn href={st.second.href} preview={preview} className={`vs-btn vs-btn-lg ${darkCard ? "vs-btn-white" : "vs-btn-outline"}`}>
                  {st.second.label}
                </Btn>
              )}
              {st.showRegister && !isLoggedIn && (
                <Btn href="/portal/register" preview={preview} className={`vs-btn vs-btn-lg ${darkCard ? "vs-btn-white" : "vs-btn-outline"}`}>
                  Register free
                </Btn>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

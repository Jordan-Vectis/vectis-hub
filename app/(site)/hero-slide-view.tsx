import Link from "next/link"
import type { CSSProperties, ReactNode } from "react"
import { DEFAULT_STYLE, type SlideStyle } from "./hero-style"

// ONE rendering of a hero slide, used by the site's hero (home-hero.tsx) and by the Banner
// Manager's preview — so what the editor shows is exactly what the site will show. No hooks, no
// state: everything comes from the slide. `preview` swaps the links for plain spans.
export type SlideData = {
  title: string
  subtitle: string
  cta: string
  ctaHref: string
  /** The picture's address (signed by the page), or null for the blue gradient. */
  imageUrl?: string | null
  /** Which part of the picture stays when it is cropped to the frame: top / center / bottom. */
  imageFocus?: string | null
  style?: SlideStyle | null
}

// A banner picture is cropped to the frame (object-cover), so a tall picture loses its top or
// bottom — the focus says which part stays (2026-09-24).
export const focusPosition = (f?: string | null) => (f === "top" ? "center top" : f === "bottom" ? "center bottom" : "center center")

const SIZE = { s: "text-3xl sm:text-4xl", m: "text-4xl sm:text-5xl", l: "text-5xl sm:text-6xl" } as const
const WIDTH = { narrow: 512, medium: 672, wide: 896 } as const
const VALIGN = { top: "justify-start pt-14", middle: "justify-center", bottom: "justify-end pb-16" } as const
const ALIGN = { left: "items-start text-left mr-auto", center: "items-center text-center mx-auto", right: "items-end text-right ml-auto" } as const
const BUTTONS = { left: "justify-start", center: "justify-center", right: "justify-end" } as const

function Btn({ href, preview, className, style, children }: { href: string; preview?: boolean; className: string; style?: CSSProperties; children: ReactNode }) {
  return preview
    ? <span className={className} style={style}>{children}</span>
    : <Link href={href} className={className} style={style}>{children}</Link>
}

export default function SlideView({ slide: s, isLoggedIn, eager, preview }: { slide: SlideData; isLoggedIn: boolean; eager?: boolean; preview?: boolean }) {
  const st = s.style ?? DEFAULT_STYLE
  return (
    <>
      {/* Background — the picture as it is, or the blue gradient when there is none. Nothing is laid
          over the picture unless this slide's own shade says so (Jordan: "remove the filter completely"). */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#1a1b3a] via-[#32348A] to-[#32348A]" />
      {s.imageUrl ? (
        <img
          src={s.imageUrl}
          alt={s.title}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ objectPosition: focusPosition(s.imageFocus) }}
          loading={eager ? "eager" : "lazy"}
        />
      ) : (
        <div className="absolute inset-0 opacity-5" style={{ backgroundImage: "radial-gradient(circle, white 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
      )}
      {st.shade > 0 && <div className="absolute inset-0 bg-black" style={{ opacity: st.shade / 100 }} />}

      <div className={`relative h-full flex flex-col px-12 ${VALIGN[st.valign]}`}>
        <div className={`flex flex-col w-full ${ALIGN[st.align]}`} style={{ maxWidth: WIDTH[st.textWidth] }}>
          {st.showKicker && (
            <div className="flex items-center gap-2 mb-6">
              <div className="h-px w-8" style={{ background: st.kickerColor }} />
              <p className="text-[10px] font-black tracking-[0.35em] uppercase" style={{ color: st.kickerColor }}>{st.kicker}</p>
            </div>
          )}
          <h1 className={`font-black leading-none mb-5 uppercase tracking-tight ${SIZE[st.headlineSize]}`} style={{ color: st.headlineColor }}>
            {s.title}
          </h1>
          <p className="text-sm mb-8 leading-relaxed max-w-lg" style={{ color: st.subtextColor }}>
            {s.subtitle}
          </p>
          <div className={`flex flex-wrap gap-3 ${BUTTONS[st.align]}`}>
            <Btn href={s.ctaHref} preview={preview} className="text-xs font-black uppercase tracking-widest px-7 py-3.5 hover:opacity-90 transition-opacity" style={{ background: st.buttonBg, color: st.buttonText }}>
              {s.cta}
            </Btn>
            {st.second && (
              <Btn href={st.second.href} preview={preview} className="border-2 text-xs font-black uppercase tracking-widest px-7 py-3.5 hover:opacity-80 transition-opacity" style={{ borderColor: st.headlineColor, color: st.headlineColor }}>
                {st.second.label}
              </Btn>
            )}
            {st.showRegister && !isLoggedIn && (
              <Btn href="/portal/register" preview={preview} className="border-2 border-white/30 hover:border-white text-white text-xs font-black uppercase tracking-widest px-7 py-3.5 transition-colors">
                REGISTER FREE
              </Btn>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

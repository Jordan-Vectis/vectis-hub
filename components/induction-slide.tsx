"use client"

import { PlanImage } from "@/components/site-plan-view"
import { pinIcon, kindName } from "@/lib/first-aid-icons"
import { lotPhotoUrl } from "@/lib/photo-url"
import { parseSlideBody, youTubeId, type BodyBlock } from "@/lib/induction"
import type { DeckSlide, LiveData } from "@/lib/induction-data"

// One induction slide, rendered the same way in the presenter and in the editor's preview.
//
// `big` is the presentation on a room screen — everything scales up. Without it the same
// slide renders at reading size inside the editor.
//
// The live blocks are the point of the whole rebuild: the PowerPoint typed the first aiders,
// the kit locations and the defibrillator locations onto slides, so they were wrong the moment
// anything changed. Here they come out of the First Aid records at the moment it is presented.

// Consecutive bullets become one list so it can be set in two columns — a six-bullet slide in
// a single column left the right-hand half of a 16:9 screen empty.
type Group = { kind: "list"; items: string[] } | { kind: "block"; block: BodyBlock }

function group(blocks: BodyBlock[]): Group[] {
  const out: Group[] = []
  for (const b of blocks) {
    const last = out[out.length - 1]
    if (b.type === "li" && last?.kind === "list") { last.items.push(b.text); continue }
    if (b.type === "li") { out.push({ kind: "list", items: [b.text] }); continue }
    out.push({ kind: "block", block: b })
  }
  return out
}

export default function InductionSlideView({ slide, live, big = false }: { slide: DeckSlide; live: LiveData; big?: boolean }) {
  const groups = group(parseSlideBody(slide.body))
  const vid    = youTubeId(slide.videoUrl)
  const img    = lotPhotoUrl(slide.imageKey)
  const layout = slide.layout || "CONTENT"

  const kits   = live.kits.filter(k => k.kind === "KIT" || k.kind === "EYEWASH")
  const defibs = live.kits.filter(k => k.kind === "DEFIB")
  const pins   = live.plan ? live.kits.filter(k => k.planId === live.plan!.id && k.pinX != null && k.pinY != null) : []

  const centred = layout === "TITLE" || layout === "STATEMENT"

  const titleCls =
    layout === "TITLE"     ? (big ? "text-6xl xl:text-8xl font-black" : "text-3xl font-black")
    : layout === "STATEMENT" ? (big ? "text-4xl xl:text-6xl font-black" : "text-2xl font-bold")
    : (big ? "text-4xl xl:text-6xl font-black" : "text-2xl font-bold")
  const subCls  = big ? (layout === "TITLE" ? "text-2xl xl:text-4xl" : "text-lg xl:text-2xl") : "text-base"
  const textCls = big ? (centred ? "text-2xl xl:text-3xl" : "text-lg xl:text-2xl") : "text-[15px]"
  const headCls = big ? "text-xl xl:text-3xl" : "text-base"

  return (
    <div className={`w-full ${centred ? "text-center flex flex-col items-center" : ""}`}>
      {/* An accent rule above the title gives every slide the same anchor — without it the
          type just floated at the top-left of a black rectangle. */}
      <div className={`h-1.5 rounded-full bg-gradient-to-r from-amber-400 to-amber-600 ${big ? "w-24" : "w-12"} ${centred ? "" : ""} mb-5`} />

      <h2 className={`${titleCls} text-gray-900 dark:text-white leading-[1.05] tracking-tight`}>{slide.title}</h2>
      {slide.subtitle && (
        <p className={`${subCls} text-amber-600 dark:text-amber-400 font-semibold mt-3 ${centred ? "max-w-4xl" : ""}`}>{slide.subtitle}</p>
      )}

      {groups.length > 0 && (
        <div className={`mt-8 space-y-5 ${centred ? "max-w-4xl" : big ? "max-w-6xl" : "max-w-5xl"} w-full`}>
          {groups.map((g, i) => {
            if (g.kind === "list") {
              // Two columns once a list is long enough to leave half a 16:9 screen empty.
              // ⚠ CSS columns, not a grid: a grid fills left-to-right, so a reader scanning
              // DOWN the left column would be reading items 1, 3, 5. Columns flow top to
              // bottom, which is how a list is read.
              const twoUp = big && g.items.length >= 5
              return (
                <ul key={i} className={`${twoUp ? "xl:columns-2 xl:gap-x-10" : ""} text-left`}>
                  {g.items.map((text, j) => (
                    <li key={j} className="flex gap-4 items-start break-inside-avoid mb-3">
                      <span className={`shrink-0 rounded-full bg-amber-500 ${big ? "h-3 w-3 mt-3" : "h-2 w-2 mt-2"}`} aria-hidden />
                      <span className={`${textCls} text-gray-700 dark:text-gray-200 leading-snug`}>{text}</span>
                    </li>
                  ))}
                </ul>
              )
            }
            const b = g.block
            if (b.type === "h") {
              return (
                <p key={i} className={`${headCls} font-bold uppercase tracking-[0.12em] text-amber-600 dark:text-amber-400 pt-2`}>
                  {b.text}
                </p>
              )
            }
            // ⚠ NORMAL weight. Every non-bullet line used to render semibold, so a heading and
            // the paragraph under it looked identical and the deck read as a wall of bold text.
            return (
              <p key={i} className={`${textCls} text-gray-700 dark:text-gray-200 leading-relaxed font-normal`}>
                {b.text}
              </p>
            )
          })}
        </div>
      )}

      {img && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt={slide.title} className="mt-8 rounded-2xl max-h-[42vh] max-w-full w-auto object-contain mx-auto shadow-2xl" />
      )}

      {slide.videoUrl && (
        <div className="mt-8 w-full">
          {vid ? (
            // A video is the one thing everyone in the room is looking at — 896px of a 1920px
            // screen wasted half of it, and the fitter has plenty of height to spare here.
            <div className={`relative w-full mx-auto ${big ? "max-w-[1200px]" : "max-w-4xl"}`} style={{ aspectRatio: "16 / 9" }}>
              <iframe
                src={`https://www.youtube.com/embed/${vid}`}
                title={slide.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 w-full h-full rounded-2xl border border-gray-300 dark:border-gray-700 shadow-2xl"
              />
            </div>
          ) : (
            // Not a YouTube link — a plain link beats an empty black box in front of a room.
            <a href={slide.videoUrl} target="_blank" rel="noreferrer" className="text-sky-500 underline break-all">
              {slide.videoUrl} ↗
            </a>
          )}
        </div>
      )}

      {slide.liveBlock === "FIRST_AIDERS" && (
        <LiveWrap big={big} empty={live.aiders.length === 0} emptyText="No first aiders are recorded in First Aid yet.">
          <div className={`grid gap-4 ${big ? "grid-cols-2 xl:grid-cols-4" : "grid-cols-2 sm:grid-cols-3"}`}>
            {live.aiders.map(a => {
              const photo = lotPhotoUrl(a.photoKey)
              return (
                <div key={a.id} className="rounded-2xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-500/5 p-4 text-center">
                  {photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo} alt={a.name} className={`${big ? "h-28 w-28" : "h-16 w-16"} rounded-full object-cover mx-auto mb-3`} />
                  ) : (
                    <div className={`${big ? "h-28 w-28 text-4xl" : "h-16 w-16 text-xl"} rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center mx-auto mb-3`}>🩹</div>
                  )}
                  <p className={`font-bold text-gray-900 dark:text-white ${big ? "text-xl" : "text-sm"}`}>{a.name}</p>
                  {a.roleTitle && <p className={`text-gray-500 dark:text-gray-400 ${big ? "text-base" : "text-xs"}`}>{a.roleTitle}</p>}
                  {a.location && <p className={`text-gray-500 dark:text-gray-400 ${big ? "text-base" : "text-xs"}`}>{a.location}</p>}
                  {a.phone && <p className={`text-gray-500 dark:text-gray-400 ${big ? "text-base" : "text-xs"}`}>{a.phone}</p>}
                </div>
              )
            })}
          </div>
        </LiveWrap>
      )}

      {(slide.liveBlock === "KITS" || slide.liveBlock === "DEFIBS") && (
        <LiveWrap
          big={big}
          empty={(slide.liveBlock === "KITS" ? kits : defibs).length === 0}
          emptyText={slide.liveBlock === "KITS" ? "No first aid kits are recorded in First Aid yet." : "No defibrillators are recorded in First Aid yet."}
        >
          <div className={`grid gap-3 ${big ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1 sm:grid-cols-2"}`}>
            {(slide.liveBlock === "KITS" ? kits : defibs).map(k => (
              <div key={k.id} className="rounded-2xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-500/5 p-4 flex gap-3 items-start text-left">
                <span className={big ? "text-4xl" : "text-2xl"} aria-hidden>{pinIcon(k.kind)}</span>
                <div>
                  <p className={`font-bold text-gray-900 dark:text-white ${big ? "text-2xl" : "text-sm"}`}>{k.label}</p>
                  <p className={`text-gray-600 dark:text-gray-400 ${big ? "text-lg" : "text-xs"}`}>{k.whereText || kindName(k.kind)}</p>
                </div>
              </div>
            ))}
          </div>
        </LiveWrap>
      )}

      {slide.liveBlock === "SITE_PLAN" && (
        <LiveWrap big={big} empty={!live.plan} emptyText="No site plan has been uploaded yet.">
          {live.plan && (
            <>
              {/* ⚠ Cap the WRAPPER's width, never the img's height: the pins are percentages of
                  the image box (site-plan-view.tsx), so constraining the picture directly would
                  drift every pin off target. At full width a ~1.4:1 drawing is taller than the
                  screen, the fitter shrinks the whole slide to compensate, and the plan ends up
                  smaller than if it had simply been narrower. */}
              <div className={big ? "mx-auto w-full max-w-[min(100%,105vh)]" : ""}>
              <PlanImage imageKey={live.plan.imageKey} alt={live.plan.name}>
                {pins.map(k => (
                  <span key={k.id}
                    style={{ left: `${k.pinX}%`, top: `${k.pinY}%` }}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 ${big ? "text-3xl" : "text-xl"} drop-shadow`}
                    title={k.label}>
                    {pinIcon(k.kind)}
                  </span>
                ))}
              </PlanImage>
              </div>
              {/* RULES.md: a symbol that means something must have a key, and a key that lists
                  the real items is more use than an abstract legend. The TYPE is named as well,
                  because that is what draws the symbol (lib/first-aid-icons.ts). */}
              {pins.length > 0 && (
                <ul className={`mt-3 grid gap-1 text-left ${big ? "text-base grid-cols-3" : "text-xs grid-cols-1 sm:grid-cols-2"} text-gray-600 dark:text-gray-300`}>
                  {pins.map(k => (
                    <li key={k.id}>{pinIcon(k.kind)} {k.label} · {kindName(k.kind)}{k.whereText ? ` — ${k.whereText}` : ""}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </LiveWrap>
      )}
    </div>
  )
}

// A slide that says nothing at all reads as "the screen is broken" in front of a room, so an
// empty live block says which record is missing and where to add it (RULES.md: never let
// "nothing happened" look like success).
function LiveWrap({ big, empty, emptyText, children }: { big: boolean; empty: boolean; emptyText: string; children?: React.ReactNode }) {
  if (empty) {
    return (
      <p className={`mt-8 rounded-xl border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-500/10 p-4 text-left text-amber-800 dark:text-amber-300 ${big ? "text-xl" : "text-sm"}`}>
        {emptyText} Add it in Facilities → First Aid and it appears here.
      </p>
    )
  }
  return <div className="mt-8 w-full">{children}</div>
}

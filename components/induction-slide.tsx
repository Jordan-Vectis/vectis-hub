"use client"

import { PlanImage } from "@/components/site-plan-view"
import { pinIcon, kindName } from "@/lib/first-aid-icons"
import { lotPhotoUrl } from "@/lib/photo-url"
import { parseSlideBody, youTubeId } from "@/lib/induction"
import type { DeckSlide, LiveData } from "@/lib/induction-data"

// One induction slide, rendered the same way in the presenter and in the editor's preview.
//
// `big` is the presentation on a room screen — everything scales up. Without it the same
// slide renders at reading size inside the editor.
//
// The live blocks are the point of the whole rebuild: the PowerPoint typed the first aiders,
// the kit locations and the defibrillator locations onto slides, so they were wrong the moment
// anything changed. Here they come out of the First Aid records at the moment it is presented.

export default function InductionSlideView({ slide, live, big = false }: { slide: DeckSlide; live: LiveData; big?: boolean }) {
  const blocks = parseSlideBody(slide.body)
  const vid    = youTubeId(slide.videoUrl)
  const img    = lotPhotoUrl(slide.imageKey)

  const titleCls = big ? "text-4xl xl:text-6xl font-black" : "text-2xl font-bold"
  const subCls   = big ? "text-xl xl:text-3xl" : "text-base"
  const textCls  = big ? "text-lg xl:text-2xl" : "text-[15px]"

  const kits   = live.kits.filter(k => k.kind === "KIT" || k.kind === "EYEWASH")
  const defibs = live.kits.filter(k => k.kind === "DEFIB")
  const pins   = live.plan ? live.kits.filter(k => k.planId === live.plan!.id && k.pinX != null && k.pinY != null) : []

  return (
    <div className="w-full">
      <h2 className={`${titleCls} text-gray-900 dark:text-white leading-tight`}>{slide.title}</h2>
      {slide.subtitle && <p className={`${subCls} text-amber-600 dark:text-amber-400 font-semibold mt-2`}>{slide.subtitle}</p>}

      {blocks.length > 0 && (
        <div className={`mt-6 space-y-3 ${textCls} text-gray-700 dark:text-gray-200 leading-relaxed`}>
          {blocks.map((b, i) =>
            b.type === "li" ? (
              <div key={i} className="flex gap-3">
                <span className="text-amber-500 shrink-0" aria-hidden>•</span>
                <span>{b.text}</span>
              </div>
            ) : (
              <p key={i} className="font-semibold text-gray-900 dark:text-white">{b.text}</p>
            )
          )}
        </div>
      )}

      {img && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt={slide.title} className="mt-6 rounded-2xl max-h-[45vh] w-auto mx-auto" />
      )}

      {slide.videoUrl && (
        <div className="mt-6">
          {vid ? (
            <div className="relative w-full max-w-4xl mx-auto" style={{ aspectRatio: "16 / 9" }}>
              <iframe
                src={`https://www.youtube.com/embed/${vid}`}
                title={slide.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 w-full h-full rounded-2xl border border-gray-300 dark:border-gray-700"
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
                <div key={a.id} className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/50 p-4 text-center">
                  {photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo} alt={a.name} className={`${big ? "h-28 w-28" : "h-16 w-16"} rounded-full object-cover mx-auto mb-3`} />
                  ) : (
                    <div className={`${big ? "h-28 w-28 text-4xl" : "h-16 w-16 text-xl"} rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center mx-auto mb-3`}>🩹</div>
                  )}
                  <p className={`font-bold text-gray-900 dark:text-white ${big ? "text-xl" : "text-sm"}`}>{a.name}</p>
                  {a.roleTitle && <p className={`text-gray-500 ${big ? "text-base" : "text-xs"}`}>{a.roleTitle}</p>}
                  {a.location && <p className={`text-gray-500 ${big ? "text-base" : "text-xs"}`}>{a.location}</p>}
                  {a.phone && <p className={`text-gray-500 ${big ? "text-base" : "text-xs"}`}>{a.phone}</p>}
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
              <div key={k.id} className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/50 p-4 flex gap-3 items-start">
                <span className={big ? "text-4xl" : "text-2xl"} aria-hidden>{pinIcon(k.kind)}</span>
                <div>
                  <p className={`font-bold text-gray-900 dark:text-white ${big ? "text-2xl" : "text-sm"}`}>{k.label}</p>
                  <p className={`text-gray-500 ${big ? "text-lg" : "text-xs"}`}>{k.whereText || kindName(k.kind)}</p>
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
              {/* RULES.md: a symbol that means something must have a key, and a key that lists
                  the real items is more use than an abstract legend. */}
              {pins.length > 0 && (
                <ul className={`mt-3 grid gap-1 ${big ? "text-lg grid-cols-2" : "text-xs grid-cols-1 sm:grid-cols-2"} text-gray-600 dark:text-gray-300`}>
                  {pins.map(k => (
                    <li key={k.id}>{pinIcon(k.kind)} {k.label}{k.whereText ? ` — ${k.whereText}` : ""}</li>
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
      <p className={`mt-6 rounded-xl border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-500/10 p-4 text-amber-800 dark:text-amber-300 ${big ? "text-xl" : "text-sm"}`}>
        {emptyText} Add it in Facilities → First Aid and it appears here.
      </p>
    )
  }
  return <div className="mt-6">{children}</div>
}

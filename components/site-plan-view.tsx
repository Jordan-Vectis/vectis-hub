"use client"

// Shared between the Site Plan app, the First Aid pin editor and the PUBLIC first aid page, so
// a pin sits in exactly the same spot in all three. Pin positions are PERCENTAGES of the image,
// never pixels — the plan is shown at wildly different widths on a phone, a monitor and a
// printout, and a pixel offset would drift on every one of them.

// ⚠ The symbol maps deliberately live in lib/first-aid-icons.ts, NOT here. This file is
// "use client", and a Server Component importing a plain object from a client module gets a
// client-reference stub instead of the data — the public page's pins rendered blank because of
// exactly that. Re-exported so existing imports keep working.
export { PIN_ICON, KIND_LABEL, pinIcon, kindName } from "@/lib/first-aid-icons"

export function PlanImage({
  imageKey, alt, children, onPick,
}: {
  imageKey: string
  alt: string
  children?: React.ReactNode
  // When given, clicking the plan reports where — as percentages, from the IMAGE's own box.
  onPick?: (x: number, y: number) => void
}) {
  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!onPick) return
    // Measure against the rendered image, not the wrapper: the wrapper can be wider than the
    // picture (letterboxing), and a percentage taken from it would put the pin off-target.
    const img = e.currentTarget.querySelector("img")
    const r = (img ?? e.currentTarget).getBoundingClientRect()
    if (!r.width || !r.height) return
    onPick(((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100)
  }

  const src = `/api/public/photo?key=${encodeURIComponent(imageKey)}`

  // ⚠ A site plan is fine architectural line work on a mostly-white sheet. Squeezed to a phone's
  // width it is unreadable, which would make the pins useless — the whole point is seeing where
  // the nearest defibrillator is. So the drawing keeps a usable minimum width and the box
  // SCROLLS, and there is always a way to open it full size and pinch-zoom natively.
  // The click maths measures the <img>'s own rect, so it stays correct while scrolled or zoomed.
  // ⚠ On a real screen the plan should simply FILL the space — no scrollbars, no artificial
  // height cap. Scrolling is only for phones, where the drawing has to stay wide enough to read
  // and the box pans instead. An earlier version forced a 900px box and a 70vh cap on every
  // screen, so a 1900px window still showed a cropped, scrolling plan with margins either side.
  return (
    <div className="space-y-2">
      <div className="overflow-auto sm:overflow-visible rounded-xl border border-gray-200 dark:border-gray-700">
        <div
          onClick={handleClick}
          className={`relative block w-full min-w-[900px] sm:min-w-0 ${onPick ? "cursor-crosshair" : ""}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className="block w-full h-auto bg-white" />
          {children}
        </div>
      </div>
      <a href={src} target="_blank" rel="noreferrer"
        className="inline-block text-xs text-sky-600 hover:underline">
        Open the plan full size ↗
      </a>
    </div>
  )
}

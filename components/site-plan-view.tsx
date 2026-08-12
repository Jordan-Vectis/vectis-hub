"use client"

// Shared between the Site Plan app, the First Aid pin editor and the PUBLIC first aid page, so
// a pin sits in exactly the same spot in all three. Pin positions are PERCENTAGES of the image,
// never pixels — the plan is shown at wildly different widths on a phone, a monitor and a
// printout, and a pixel offset would drift on every one of them.

// ⚠ THE one icon map. The public page used to keep its own identical copy — the classic pair
// that drifts. Everything that draws a first aid symbol imports these.
// 📍 is genuinely the "Other" symbol, not a fallback for a broken type: a kit shows 📍 because
// its TYPE is Other, which is why the key names the type alongside it.
export const PIN_ICON: Record<string, string> = {
  KIT: "🧰", DEFIB: "⚡", EYEWASH: "💧", OTHER: "📍",
}

export const KIND_LABEL: Record<string, string> = {
  KIT: "First aid kit", DEFIB: "Defibrillator", EYEWASH: "Eyewash", OTHER: "Other",
}

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
  return (
    <div className="space-y-2">
      <div className="overflow-auto rounded-xl border border-gray-200 dark:border-gray-700 max-h-[70vh]">
        <div
          onClick={handleClick}
          className={`relative inline-block min-w-[900px] ${onPick ? "cursor-crosshair" : ""}`}
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

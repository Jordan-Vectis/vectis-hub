// The handheld scanner's icons — plain inline SVGs (24 × 24, currentColor), never emoji: an emoji is
// drawn by the device's own font, so it changes size and colour from one scanner to the next.
// Every icon is decorative (aria-hidden); whatever holds it carries the words or an aria-label.
// Server-safe (no hooks).

import type { ReactNode } from "react"

type P = { className?: string }

function Svg({ className = "h-6 w-6", children, fill = false }: P & { children: ReactNode; fill?: boolean }) {
  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox="0 0 24 24"
      className={className}
      fill={fill ? "currentColor" : "none"}
      stroke={fill ? "none" : "currentColor"}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

/** The settings cog. */
export function GearIcon(p: P) {
  return (
    <Svg {...p}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  )
}

export function BackIcon(p: P) {
  return <Svg {...p}><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></Svg>
}

export function CloseIcon(p: P) {
  return <Svg {...p}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Svg>
}

export function ChevronIcon(p: P) {
  return <Svg {...p}><path d="m9 18 6-6-6-6" /></Svg>
}

export function DownIcon(p: P) {
  return <Svg {...p}><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></Svg>
}

export function OkIcon(p: P) {
  return <Svg {...p}><circle cx="12" cy="12" r="10" /><path d="m8 12 3 3 5-6" /></Svg>
}

export function WarnIcon(p: P) {
  return (
    <Svg {...p}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Svg>
  )
}

export function ErrorIcon(p: P) {
  return <Svg {...p}><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6" /><path d="m9 9 6 6" /></Svg>
}

export function InfoIcon(p: P) {
  return <Svg {...p}><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></Svg>
}

/** "Scan something": a barcode in a frame. */
export function ScanIcon(p: P) {
  return (
    <Svg {...p}>
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <path d="M8 8v8" />
      <path d="M12 8v8" />
      <path d="M16 8v8" />
    </Svg>
  )
}

/** Put away / Move: a box with an arrow. */
export function MoveIcon(p: P) {
  return (
    <Svg {...p}>
      <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
      <path d="m3 8 9 5 9-5" />
      <path d="M12 13v8" />
    </Svg>
  )
}

export function FindIcon(p: P) {
  return <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></Svg>
}

/** Check a location: a ticked list. */
export function CheckListIcon(p: P) {
  return (
    <Svg {...p}>
      <path d="m3 6 2 2 3-3" />
      <path d="m3 13 2 2 3-3" />
      <path d="M12 7h9" />
      <path d="M12 14h9" />
      <path d="M12 20h9" />
    </Svg>
  )
}

/** A location that stays set. */
export function PinIcon(p: P) {
  return (
    <Svg {...p}>
      <path d="M20 10c0 4.99-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 14.99 4 10a8 8 0 0 1 16 0" />
      <circle cx="12" cy="10" r="3" />
    </Svg>
  )
}

/** The idle sign-in prompt: a QR code. */
export function QrIcon(p: P) {
  return (
    <Svg {...p} fill>
      <path d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm8-2h2v2h-2v-2zm2 2h2v2h-2v-2zm2-2h2v2h-2v-2zm2 2h2v2h-2v-2zm-6 2h2v2h-2v-2zm4 0h2v2h-2v-2zm-2 2h2v2h-2v-2zm4 0h2v2h-2v-2z" />
    </Svg>
  )
}

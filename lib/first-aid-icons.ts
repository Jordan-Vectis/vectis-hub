// ⚠ PLAIN module — deliberately NOT marked "use client", and it must stay that way.
//
// These maps are read by BOTH the public first aid page (a Server Component) and the client-side
// pin editor. When a Server Component imports a plain object from a "use client" module, Next
// replaces it with a client-reference stub rather than the real value — components still render,
// but data comes back empty. That is exactly what happened when these lived in
// components/site-plan-view.tsx: every pin on the public page silently fell back to a hardcoded
// "📍", which read as "the symbol is broken" and hid the real cause for a while.
//
// So: symbols and labels live here, in a module with no "use client", and site-plan-view
// re-exports them for convenience. Don't move them back.

export const PIN_ICON: Record<string, string> = {
  KIT: "🧰", DEFIB: "⚡", EYEWASH: "💧", OTHER: "📍",
}

export const KIND_LABEL: Record<string, string> = {
  KIT: "First aid kit", DEFIB: "Defibrillator", EYEWASH: "Eyewash", OTHER: "Other",
}

// 📍 is the genuine symbol for "Other", not a fallback for a broken type — which is why the key
// names the type alongside it, so a pin can never look like a bug again.
export const pinIcon  = (kind: string) => PIN_ICON[kind]   ?? PIN_ICON.OTHER
export const kindName = (kind: string) => KIND_LABEL[kind] ?? KIND_LABEL.OTHER

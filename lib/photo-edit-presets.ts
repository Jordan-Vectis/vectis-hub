// Presets for Photo Prep → AI Edit. Shared by the route and the UI so the
// buttons and the prompts can't drift apart.
//
// ⚠⚠ CONDITION INTEGRITY — the rule this whole feature hangs on.
// These photos are what bidders bid on. Editing the ITEM — removing a scratch,
// a chip, fading, wear, a missing part — misrepresents the lot and would land
// Vectis in a dispute it deserves to lose. Every preset here fixes the
// PHOTOGRAPH (framing, backdrop, lighting, glare, clutter around the item) and
// CONDITION_RULE is appended to all of them so the model is told, every single
// time, to leave the object itself exactly as it is.
//
// If you add a preset, it must pass this test: would a bidder feel misled if
// they saw the original next to yours? If yes, don't add it.

export const CONDITION_RULE = `
ABSOLUTE RULES — these override anything above:
- This is an auction photograph. NEVER alter the item being sold. Do not remove, hide, reduce or repair ANY scratch, chip, crack, dent, rust, fading, discolouration, wear, dirt on the item, missing part, tear, crease or damage. Do not restore paint, print, plating or packaging. Do not make the item look newer, cleaner or more complete than it is.
- Do not add, remove or substitute any part of the item or its packaging. Do not change its colour, shape, markings, text or logos.
- You may only change the PHOTOGRAPH around the item: framing, background, lighting, glare on the lens, and objects that are not part of the lot.
- Keep the item's position, scale and proportions exactly as they are unless the instruction explicitly asks to straighten the view.
- If you cannot do the requested edit without altering the item, return the image unchanged.`

export type EditPreset = {
  key:      string
  label:    string
  /** Shown under the button — plain English, for the photographer. */
  blurb:    string
  prompt:   string
  /** Offers the aspect-ratio choice (only the extend preset needs it). */
  aspect?:  boolean
  /** Grouping in the UI. */
  group:    "Framing" | "Background" | "Light" | "Quality"
}

export const EDIT_PRESETS: EditPreset[] = [
  // ── Framing ──
  {
    key: "extend", group: "Framing", aspect: true,
    label: "Extend the shot",
    blurb: "Adds more background around a photo cropped too tight, so the item isn't jammed against the edge.",
    prompt: "Extend this photograph outwards, generating more of the existing background around the subject so the item is no longer tight against the edges. Match the existing backdrop's colour, texture, lighting and grain seamlessly. Leave the item itself untouched and in the same place — only add new background around it.",
  },
  {
    key: "straighten", group: "Framing",
    label: "Straighten",
    blurb: "Squares up an item photographed slightly skewed or rotated.",
    prompt: "Correct the perspective and rotation of this photograph so the item sits square to the frame — horizontals level, verticals upright. Fill any corners this exposes with matching background. Do not change the item itself.",
  },
  {
    key: "centre", group: "Framing",
    label: "Centre the item",
    blurb: "Re-balances a photo where the item sits off to one side.",
    prompt: "Reposition the framing of this photograph so the item is centred with even margins on all sides, generating matching background where needed. Do not resize, alter or redraw the item.",
  },

  // ── Background ──
  {
    key: "sweep", group: "Background",
    label: "Clean sweep",
    blurb: "Swaps a busy bench or cluttered room for a plain studio backdrop.",
    prompt: "Replace the background of this photograph with a clean, evenly-lit plain studio sweep in a neutral light grey, keeping a soft natural shadow beneath the item so it still sits on a surface. Preserve the item exactly — every edge, marking and imperfection — and keep its original lighting direction.",
  },
  {
    key: "white", group: "Background",
    label: "Cut out to white",
    blurb: "Isolates the item on pure white for a website listing.",
    prompt: "Place this item on a pure white background with a subtle soft shadow beneath it, as a catalogue product shot. Cut around the item precisely, including thin or transparent parts. Preserve the item exactly as photographed — do not smooth, clean or repair it.",
  },
  {
    key: "declutter", group: "Background",
    label: "Remove clutter",
    blurb: "Takes out hands, tools, props and stray objects that aren't part of the lot.",
    prompt: "Remove from this photograph any objects that are NOT part of the item being sold — hands, fingers, tools, packaging materials being held, props, other products, cables, clutter on the bench. Fill the space with matching background. Keep everything that is part of the lot, including its own box, packaging, paperwork and accessories.",
  },
  {
    key: "label", group: "Background",
    label: "Remove label / sticker",
    blurb: "Removes an auction label or barcode card lying next to the item.",
    prompt: "Remove any auction label, barcode card, price tag or paper slip that is lying beside or on top of the item as a separate object, and fill the area with matching background. Do NOT remove any label, sticker, sticker residue or marking that belongs to the item or its packaging — those are part of what is being sold.",
  },

  // ── Light ──
  {
    key: "lighting", group: "Light",
    label: "Even the lighting",
    blurb: "Lifts a dark corner or harsh shadow without changing the item's colour.",
    prompt: "Even out the lighting in this photograph: lift shadows that hide detail, tame blown highlights, and balance brightness across the frame so the item is evenly lit. Keep the item's true colours and finish. Do not remove marks or wear that become more visible as a result — they must remain.",
  },
  {
    key: "glare", group: "Light",
    label: "Kill glare",
    blurb: "Reduces lamp reflections on glass, perspex boxes and shiny surfaces.",
    prompt: "Reduce lens and lamp glare and specular reflections on the photograph — hotspots on glass, perspex, cellophane or polished surfaces — so what is underneath becomes visible. Reveal what the glare was hiding rather than inventing detail; if you cannot tell what is underneath, leave that area as it is. Do not alter the item.",
  },
  {
    key: "colour", group: "Light",
    label: "Fix colour cast",
    blurb: "Strips a yellow or blue cast from bad room lighting.",
    prompt: "Correct the white balance of this photograph to neutral daylight, removing any yellow, orange, green or blue colour cast from artificial lighting, so whites read white. The item's own colours must end up accurate to life — do not saturate, stylise or 'improve' them.",
  },

  // ── Quality ──
  {
    key: "sharpen", group: "Quality",
    label: "Sharpen",
    blurb: "Rescues a photo that came out slightly soft or shaky.",
    prompt: "Sharpen this slightly soft photograph and reduce motion blur so text, edges and detail read clearly. Do not invent detail that isn't there, and do not smooth away surface wear, scratches or texture on the item.",
  },
  {
    key: "denoise", group: "Quality",
    label: "Reduce grain",
    blurb: "Cleans up speckly noise from a photo shot in poor light.",
    prompt: "Reduce digital noise and grain in this photograph while keeping edges and fine surface detail crisp. Do not smooth or blur the item's surface — scratches, wear and texture must stay visible.",
  },
  {
    key: "upscale", group: "Quality",
    label: "Upscale",
    blurb: "Makes a small photo bigger and cleaner for the website.",
    prompt: "Increase the resolution of this photograph, producing a larger, cleaner version with crisp edges and readable detail. Reproduce what is there faithfully — do not invent detail, and do not clean up or repair the item.",
  },
  {
    key: "dust", group: "Quality",
    label: "Remove dust specks",
    blurb: "Removes sensor dust and stray specks on the backdrop — never marks on the item.",
    prompt: "Remove sensor dust spots, hairs and stray specks that are on the BACKDROP or empty background of this photograph only. Do not touch anything on or near the item — dust, marks, scratches and blemishes on the item itself must remain exactly as photographed.",
  },
]

export const PRESET_BY_KEY: Record<string, EditPreset> =
  Object.fromEntries(EDIT_PRESETS.map(p => [p.key, p]))

export const ASPECTS = [
  { key: "keep",  label: "Same shape" },
  { key: "1:1",   label: "Square" },
  { key: "4:5",   label: "Portrait 4:5" },
  { key: "3:2",   label: "Landscape 3:2" },
  { key: "16:9",  label: "Wide 16:9" },
] as const

/** The full instruction sent to the model: preset + options + any free text. */
export function buildEditPrompt(
  presetKey: string,
  opts?: { aspect?: string; extra?: string },
): string | null {
  const preset = PRESET_BY_KEY[presetKey]
  if (!preset) return null
  const bits = [preset.prompt]
  if (preset.aspect && opts?.aspect && opts.aspect !== "keep") {
    bits.push(`Produce the result in a ${opts.aspect} aspect ratio, adding background as needed rather than cropping the item.`)
  }
  if (opts?.extra?.trim()) {
    bits.push(`Also: ${opts.extra.trim()}`)
  }
  bits.push(CONDITION_RULE)
  return bits.join("\n\n")
}

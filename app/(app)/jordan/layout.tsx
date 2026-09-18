import { JSYS_BOOT_SCRIPT, JSYS_PALETTE_CSS } from "@/lib/jordan-theme"
import { JsysThemeBoot } from "./jsys-style"

// JORDAN.SYS layout — only here to carry the LOOK & FEEL (lib/jordan-theme.ts):
//   · the <style> that turns the palette table into CSS variables, keyed off <html data-jsys="…">;
//   · an inline script that sets the look and palette attributes from localStorage BEFORE the page
//     paints, so a saved look never flashes the terminal first on a full load;
//   · <JsysThemeBoot/>, which does the same on mount for client-side navigations, where inline
//     scripts do not run;
//   · the `.jsys` wrapper every shape rule in globals.css is scoped to — the attributes live on
//     <html> and stay there after leaving /jordan, so without this scope a MODERN look would round
//     off the corners of the whole Hub. `contents` keeps it out of the layout (display: contents).
// The pages under it are unchanged in shape — each still renders its own shell — they just read
// the variables instead of hardcoding colours. The gate (isJordan → 404) stays on every page.
export default function JordanLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: JSYS_PALETTE_CSS }} />
      <script dangerouslySetInnerHTML={{ __html: JSYS_BOOT_SCRIPT }} />
      <JsysThemeBoot />
      <div className="jsys contents">{children}</div>
    </>
  )
}

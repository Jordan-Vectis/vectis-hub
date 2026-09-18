import { JSYS_BOOT_SCRIPT, JSYS_THEME_CSS } from "@/lib/jordan-theme"
import { JsysThemeBoot } from "./jsys-style"

// JORDAN.SYS layout — only here to carry the LOOK & FEEL theme (lib/jordan-theme.ts):
//   · the <style> that turns the palette table into CSS variables, one block per theme, keyed
//     off <html data-jsys="…">;
//   · an inline script that sets that attribute from localStorage BEFORE the page paints, so a
//     saved theme never flashes green first on a full load;
//   · <JsysThemeBoot/>, which does the same on mount for client-side navigations, where inline
//     scripts do not run.
// The pages under it are unchanged in shape — each still renders its own shell — they just read
// the variables instead of hardcoding the colours. The gate (isJordan → 404) stays on every page.
export default function JordanLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: JSYS_THEME_CSS }} />
      <script dangerouslySetInnerHTML={{ __html: JSYS_BOOT_SCRIPT }} />
      <JsysThemeBoot />
      {children}
    </>
  )
}

import type { CapacitorConfig } from "@capacitor/cli";
import hubs from "./hubs.json";

// Vectis Scanner: a thin Android wrapper round the Hub's own /scan screen.
//
// The app shows the Hub itself (server.url), so it signs in with the Hub's normal login and every
// screen change ships with the Hub, not with the app. Which Hub is decided when `cap sync` runs:
//
//   HUB_URL=https://vectis-staging.up.railway.app npx cap sync android
//
// No HUB_URL means production. The GitHub workflow runs `cap sync` once per build (production,
// staging, sandbox) with that build's address from hubs.json, and the Android build checks the
// address it was given matches its flavour before it will build (android/app/build.gradle).

const raw = (process.env.HUB_URL ?? "").trim() || hubs.production.url;

let hub: URL;
try {
  hub = new URL(raw);
} catch {
  throw new Error(`HUB_URL "${raw}" isn't a web address (expected e.g. ${hubs.production.url}).`);
}
if (hub.protocol !== "https:") {
  throw new Error(`HUB_URL must start with https:// (got "${raw}") — the app never talks to the Hub unencrypted.`);
}
if (hub.pathname !== "/" || hub.search || hub.hash) {
  throw new Error(`HUB_URL must be just the Hub's address with no path (got "${raw}").`);
}

const config: CapacitorConfig = {
  appId: "uk.co.vectis.scanner",
  appName: "Vectis Scanner",
  // Built from web/ by scripts/build-web.mjs (the capacitor:copy:before hook) on every sync.
  // It only holds the offline page: everything else comes from the Hub.
  webDir: "www",
  server: {
    url: hub.origin,
    appStartPath: "/scan",
    // Shown when the Hub can't be reached (no Wi-Fi, or the Hub answering with an error). It is a
    // file inside the app, so it always opens; it says the scans already made are safe and retries.
    errorPath: "offline.html",
    cleartext: false,
    androidScheme: "https",
    // Only the Hub opens inside the app. Any other link opens in the device's browser.
    allowNavigation: [hub.host],
  },
  appendUserAgent: "VectisScanner/1",
  backgroundColor: "#030712",
  android: {
    allowMixedContent: false,
    captureInput: false,
    webContentsDebuggingEnabled: false,
    // Newer Android (15+) draws apps under the status bar; keep the Hub's screen clear of it.
    adjustMarginsForEdgeToEdge: "auto",
    // The Hub (Next.js 16, Tailwind v4) needs Chrome 111+. On an older Android System WebView the
    // app opens the offline page (server.errorPath) instead, which says the web viewer needs
    // updating — rather than a Hub page that loads but doesn't work, with no word why.
    minWebViewVersion: 111,
    // ⚠ Keep on (Capacitor's default): the /scan service worker's fetches must go through Capacitor,
    // so the native bridge is put into the saved copy of the page it serves offline. Without it, a
    // page opened offline has no window.Capacitor and scans taken straight from the scanner are lost.
    resolveServiceWorkerRequests: true,
  },
  plugins: {
    NewlandScanner: {
      // Take scans straight from the Newland scan engine while the app is on screen (default on).
      // Can also be switched per device from the page with setTakeScansDirectly({ on }).
      takeScansDirectly: true,
      // What the scan engine is put back to when the app leaves the screen (Newland's EXTRA_SCAN_MODE),
      // so the device's other apps keep getting scans the way they expect:
      //   2 = "Simulate keystroke" (keyboard output, what a web page in Chrome needs) — the default
      //   1 = "Fill in EditText directly" (Newland's factory setting)
      //   3 = "Output via API" (broadcast) — for another scanning app on the same device that needs it
      //   0 = send nothing: leave the scanner as this app set it (API output)
      // ⚠ Newland gives no way to read the previous setting, so it can't simply be "put back" — check
      // what else runs on the scanners before changing this. Switching "Take scans straight from the
      // scanner" off on the screen always gives keyboard output (2, or 1 when that is set here).
      keyboardOutputMode: 2,
      // Other makes of scanner: the broadcast their scan app sends and the extra holding the code.
      // Leave blank for Newland — the Newland broadcasts are always listened for.
      customAction: "",
      customExtra: "",
    },
  },
};

export default config;

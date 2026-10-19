# Vectis Scanner — the Android app for the Newland scanners

Vectis Scanner is a small Android app for the warehouse's Newland handheld scanners. It opens
the Hub's own scanner screen (`/scan`, part of Goods In) full screen and adds four things a web
page in Chrome can't do on its own:

- **Scans go straight to the screen.** The app takes each scan directly from the Newland scan
  engine, so a scan can't type itself into the wrong box.
- **Scans are kept when the Wi-Fi drops.** Every scan is saved on the scanner and sent as soon as
  the Hub can be reached again. If the Hub can't be reached at all, the app shows a "Can't reach the
  Hub" page that says the scans are safe, and keeps trying by itself.
- **It behaves like a scanner app.** Portrait only, the screen stays on while it's open, and Back
  steps back through the scanner screen — it only closes the app after asking.
- **It ignores the scanner's system font size.** The app shows the scanner screen's text at the
  size the screen was designed for, whatever Android's **Font size** setting is, so a larger system
  font can't push the text out of its boxes and make the screen overlap. (Other apps on the scanner
  still follow the setting. Android's **Display size** setting still makes the whole screen larger
  or smaller, text and boxes together.) An APK built before this was added still follows the font
  size, so install the newest one.

The screens themselves live in the Hub, so a change to the scanner screen reaches every scanner as
soon as the Hub updates. The app only needs installing again when this folder changes.

The app only works with the Hub. It doesn't connect to a PC, and it doesn't talk to Business Central.

There are three versions, and they can all be installed on the same scanner:

| App on the scanner | Opens | For |
|---|---|---|
| **Vectis Scanner** | https://vectis-production.up.railway.app | everyday use |
| **Vectis Scanner (Staging)** | https://vectis-staging.up.railway.app | trying changes before they go live |
| **Vectis Scanner (Sandbox)** | https://vectis-hub-sandbox.up.railway.app | experiments |

---

## Installing it on a scanner

You need the APK file (the app's installer). GitHub builds it, so nothing needs installing on a PC.

1. **Get the APK.** On GitHub, open the repository's **Actions** tab, then **Scanner app**, and pick
   the newest run with a green tick. Its summary page has a download link for each version, e.g.
   `vectis-scanner-production-20261016-1a2b3c4.apk` (the date it was built and the code version).
   You have to be signed in to GitHub to download it.
   - **From a PC:** download it, plug the scanner in with its USB cable, choose **File transfer** on
     the scanner's screen, and copy the APK into the scanner's **Download** folder.
   - **Or on the scanner itself:** open the run's page in the scanner's browser, sign in to GitHub,
     and tap the download link.
2. **Open the APK on the scanner** — from the **Files** app (Download folder), or from the browser's
   downloads.
3. The first time, Android says installing unknown apps isn't allowed. Tap **Settings**, switch on
   **Allow from this source** for that app (Files or the browser), then go back.
4. Tap **Install**, then **Open**.
5. **Sign in with your Hub login** — the same email and password as the Hub on a PC.

After that it's on the home screen as **Vectis Scanner** (blue icon with white barcode bars).

### Shared scanners

The scanners are shared, so the scanner screen has a **Switch user** button. Every scan records who
was signed in when it was made. Switch user waits until that person's scans have been sent, so
nobody's scans are sent under someone else's name.

### Updating

Install the new APK over the old one, exactly as above — **don't uninstall first**. Uninstalling
throws away anything still waiting to send on that scanner.

An update only installs over the old app if both were signed with the same key (see *The signing
key* below). If Android says **"App not installed"** when updating, the new APK was signed with a
different key — check the run's summary for the "NOT signed with the Vectis key" warning.

---

## How it takes scans (Newland scanners)

Out of the box a Newland scanner *types* each barcode into whatever box has focus. While Vectis
Scanner is on screen, the app tells the scanner to send scans to the app instead (Newland calls
this "Output via API" or "Broadcast output"). When you leave the app — home button, another app,
screen off — it puts the scanner back to typing ("Simulate keystroke"), so the scanner's other apps
carry on working as before.

This works on every Android Newland model (MT65, MT90, MT93, N7, NFT10 …) — it's the scanning
interface Newland documents in its *Android PDA API Handbook*. On other makes of scanner, or if
this is switched off, the scanner screen still works: it reads scans typed in by the scanner
("keyboard output"), as it does in Chrome.

Settings, in `capacitor.config.ts` → `plugins.NewlandScanner` (they need a rebuild of the app):

| Setting | Default | What it does |
|---|---|---|
| `takeScansDirectly` | `true` | Take scans straight from the scanner while the app is on screen. |
| `keyboardOutputMode` | `2` | What the scanner goes back to when you leave the app: `2` = Simulate keystroke (keyboard), `1` = Fill in EditText directly (Newland's factory setting), `3` = Output via API (broadcast — for another scanning app on the same scanner that needs it), `0` = send nothing (the scanner stays as the app set it). Newland gives no way to read the setting from before, so check what else runs on the scanners before the first rollout. Switching *Take scans straight from the scanner* off on the screen always gives keyboard output (`2`, or `1` when that's set). |
| `customAction` / `customExtra` | blank | Another make of scanner: the broadcast its scan app sends and the extra holding the barcode. |

If the app ever closes unexpectedly and the scanner's other apps stop getting scans, open Vectis
Scanner and close it again with Back (or set the output mode in the scanner's Scan settings, below).

## Using the scanner screen without the app

The scanner screen also works in Chrome on any scanner set to keyboard output — open
`https://vectis-production.up.railway.app/scan` and sign in. (Without the app, a scan can land in
whichever box has focus, and the offline page isn't there.)

To set a Newland scanner to keyboard output: open the **Scan** (or **Quick Setting** → **Scan**)
app on the scanner, then **Output mode** → **Simulate keystroke**, and switch **on** the option that
adds an Enter after each scan (shown as *Add a line feed*, *Enter* or *Append Enter*, depending on
the model). Names vary a little between models and Android versions.

## When something's not right

| What you see | What to do |
|---|---|
| **"Can't reach the Hub"** with good Wi-Fi | The Hub may be restarting after an update — give it a minute; the page retries by itself. Scans already made are safe. |
| The app opens on **"This scanner's web viewer is too old for the Hub"** | The Hub needs **Android System WebView 111 or newer**, so the app won't open the scan screen on an older one (it would load but not work). Update it from the Play Store on the scanner, or ask Newland/IT for a firmware update if the scanner has no Play Store. That page doesn't retry by itself; *Try anyway* is there if you want to. |
| A Hub page saying **"not found"** or **"no access"** inside the app | That's the Hub's own answer, not the Wi-Fi (only the Hub being down or restarting shows "Can't reach the Hub"). Usually the scanner screen isn't on that Hub yet, or that login has no Goods In access. |
| Scans **type into boxes** inside the app instead of going straight to the screen | In the scanner's **Scan** settings, check the broadcast (API) output still uses Newland's default action, `nlscan.action.SCANNER_RESULT`, and extra `SCAN_BARCODE1` (another app may have changed them) — or press *Restore defaults* there. |
| **"Scan not taken — scan it again"** | The scan screen was still opening. Scan the item again. |
| **"App not installed"** when updating | The new APK was signed with a different key. See *The signing key*. |

---

## The signing key (once, on Jack's PC)

Android only installs an update over an app signed with the same key, so the APKs must always be
signed with one Vectis key. GitHub signs them with it if it has these four repository secrets:
`SCANNER_KEYSTORE_BASE64`, `SCANNER_KEYSTORE_PASSWORD`, `SCANNER_KEY_ALIAS`, `SCANNER_KEY_PASSWORD`.

To make the key and give it to GitHub — **once only**:

```
cd scanner-app
npm install
node scripts/make-signing-key.mjs
```

It saves the key and a **KEEP THIS SAFE** note with its passwords in
`Documents\Vectis Scanner signing key\` (never in the repository), then tries to store the four
secrets on GitHub with the GitHub CLI (`gh`). It never shows the passwords on screen. If `gh` isn't
allowed to set secrets (only the repository's owner or an admin can), it prints exactly what
Jordan needs to do instead. Keep a copy of that folder somewhere safe and private — if the key is
lost, every scanner has to have the app uninstalled and installed again.

Until the secrets are there, GitHub still builds the APKs but signs them with a throwaway key and
says so at the top of the run. They're fine for trying out, but they won't install over each other.

## How it's built

GitHub builds the three APKs (`.github/workflows/scanner-app.yml`) whenever a change to
`scanner-app/` is pushed to `staging` or `main`. To build without a change: **Actions** → **Scanner
app** → **Run workflow** — but GitHub only shows that button once the workflow file is on `main` (the
repository's default branch). Until then, push a change under `scanner-app/` to `staging`, or open
the latest run and press **Re-run all jobs**. Each build:

1. installs Java 21, Node 20 and the Android SDK;
2. for each version, runs `HUB_URL=<its Hub> npx cap sync android` (which points the app at that Hub
   and rebuilds the offline page for it) and `./gradlew assemble<Version>Release`;
3. uploads the three APKs, named with the date and the short commit, and writes install steps in the
   run's summary.

The version number goes up with every run (1.0.*run number*), so a newer APK always installs over
an older one.

---

## For developers

Nothing here can be built on a PC without Java 21 and the Android SDK; GitHub is where it's built.
Don't run `npm run dev` for the Hub to test this — see RULES.md.

| Path | What it is |
|---|---|
| `capacitor.config.ts` | App id `uk.co.vectis.scanner`, the Hub address (`HUB_URL`, default production), the offline page, the scanner settings. |
| `hubs.json` | The three Hubs and app names. The workflow, the offline page and the Android build all read it. |
| `web/` | The app's own pages: `offline.html` (and an `index.html` that just opens the Hub). Built into `www/` by `scripts/build-web.mjs` on every `cap sync`; `www/` isn't committed. |
| `android/` | The Android project (Capacitor 7). Three product flavours — `production`, `staging` (`.staging`), `sandbox` (`.sandbox`). The build refuses to make a flavour whose `capacitor.config.json` points at another Hub. |
| `android/app/src/main/java/uk/co/vectis/scanner/NewlandScannerPlugin.java` | The scanner plugin. |
| `android/app/src/main/java/uk/co/vectis/scanner/MainActivity.java` | Registers the plugin; screen on; the WebView's text zoom fixed at 100% (`setTextZoom(100)`, so the system font size is ignored); Back. |
| `scripts/make-signing-key.mjs` | Makes the signing key (once) and stores the GitHub secrets. |
| `scripts/make-icons.mjs` | Draws the launcher icon (only if it should change). |

Generated, not committed: `www/`, `android/app/src/main/assets/public`, `capacitor.config.json`,
`capacitor.plugins.json`, `android/capacitor-cordova-android-plugins/`, build outputs.

### What the page gets from the app

The page sees Capacitor as `window.Capacitor` (`Capacitor.isNativePlatform()` is true inside the
app) and the plugin as `Capacitor.Plugins.NewlandScanner`:

```ts
interface NewlandScannerPlugin {
  /** available: the device has the Newland scan service (or a scan has arrived / custom broadcast set).
   *  direct: the scanner is sending scans to the app right now. */
  isAvailable(): Promise<{ available: boolean; newland: boolean; takeScansDirectly: boolean;
                           direct: boolean; manufacturer: string; model: string }>
  setTakeScansDirectly(o: { on: boolean }): Promise<{ takeScansDirectly: boolean; direct: boolean }>
  setCustomBroadcast(o: { action: string; extra: string }): Promise<{ action: string; extra: string }>
  addListener(event: "scan", cb: (e: { code: string; source: "newland" | "scannerservice" | "custom" }) => void)
    : Promise<{ remove(): Promise<void> }>
}
```

- `code` has any trailing Enter/Tab and spaces taken off. A failed read (nothing decoded) never
  arrives.
- Keep the page's keyboard-style input listening inside the app too: a scan made in the moment
  after the app comes to the front can still arrive as typing, and other makes of scanner always
  type.
- If a scan arrives while the page has no `scan` listener, the app offers it as a cancelable
  `vectis-scan` event on `window` (`detail: { code, source }`). A page that takes it must call
  `event.preventDefault()`; if nothing does (the screen is still loading), the app shows a short
  "Scan not taken — scan it again" message rather than losing the scan silently.
- **Back:** the app first fires a cancelable `vectis:back` event on `window`. A page that can step
  back within its own flow (cancel a half-done move) calls `event.preventDefault()`; otherwise the
  app goes back to the previous `/scan` page, or asks before closing.
- **Signing in:** the Hub's login always lands on `/hub`. Inside the app, arriving at `/hub`,
  `/submissions` or `/` sends the app straight back to `/scan`, so people signing in on a scanner
  end up on the scanner screen. Other Hub pages linked from `/scan` open normally.
- The Haptics plugin (`Capacitor.Plugins.Haptics`) is included for vibration; `navigator.vibrate`
  works too.
- The app adds `VectisScanner/1` to the browser's user agent, if the Hub ever needs to tell it apart.
- Permissions: Internet, network state and vibrate only.

### Pointing a build at a Hub by hand

```
HUB_URL=https://vectis-staging.up.railway.app npx cap sync android
```

(PowerShell: `$env:HUB_URL="https://vectis-staging.up.railway.app"; npx cap sync android`.) No
`HUB_URL` means production. The address must be `https://` with no path.

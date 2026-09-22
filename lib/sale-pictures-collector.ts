// The browser-console version of scripts/collect-sale-pictures.mjs — pasted into the console on
// vectis.co.uk from an office machine (the website will not answer the Hub's own server). It reads
// ONE page per sale number for the sale's cover picture, title and date, and never the lot feed,
// so the whole site takes about ten minutes. ⚠ Same page-reading as the Node script and the lot
// collectors — change one, change the others.

export function salePicturesScript(opts: { from: number; to: number }): string {
  const { from, to } = opts
  return `/* Vectis Hub — collect every sale's cover picture from the website.
   Run this ON www.vectis.co.uk with the console open. It saves a file to your Downloads every 200
   sales and at the end; load them on the Hub's Databases → Sales page. Safe to stop and re-run. */
(async () => {
  const FROM = ${from};      // first sale number on the website to look at
  const TO   = ${to};        // last one
  const PAUSE = 250, PER_FILE = 200;
  const KEY = "vectisHubPictures";
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const decode = s => String(s).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/&#(\\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&nbsp;/g, " ");

  const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } })();
  const resuming = saved && saved.from === FROM && saved.to === TO && saved.next > FROM;
  let at = resuming ? saved.next : FROM;
  let part = resuming ? (saved.part || 1) : 1;
  let sales = [], found = 0, heroes = 0, gaps = 0, stopped = false;
  const failed = [];

  window.vectisStop  = () => { stopped = true; console.log("Stopping after this sale — the file will be saved."); };
  window.vectisReset = () => { localStorage.removeItem(KEY); console.log("Start position cleared — run it again to start from the beginning."); };

  function remember(next) { try { localStorage.setItem(KEY, JSON.stringify({ from: FROM, to: TO, next: next, part: part })); } catch (e) {} }
  function save(next) {
    if (!sales.length) { remember(next); return; }
    const name = "vectis-sale-pictures-" + String(part).padStart(2, "0") + ".json";
    const blob = new Blob([JSON.stringify({ collectedAt: new Date().toISOString(), kind: "sale-pictures", sales: sales })], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    console.log("%c\\u2193 Saved " + name + " — " + found + " sales, " + heroes + " pictures so far", "color:#2AB4A6;font-weight:bold");
    part++; sales = [];
    remember(next);
  }

  // The sale's own page — title, date, cover picture. Not a sale (the error page) → {}; would not
  // load after three tries → null.
  async function salePage(saleId) {
    for (let go = 1; go <= 3; go++) {
      let res;
      try { res = await fetch("/bidding/0-x-" + saleId, { credentials: "same-origin", headers: { "Accept": "text/html,application/xhtml+xml" } }); }
      catch (e) { await sleep(1500 * go); continue; }
      if (res.status === 404 || res.status >= 500) return {};
      if (!res.ok) { await sleep(1500 * go); continue; }
      const html = await res.text();
      const t = html.match(/<title>\\s*Vectis Auctions\\s*\\|\\s*([^<]*)<\\/title>/i);
      const d = html.match(/\\b(\\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\\d{4})\\b/);
      const h = html.match(/auction_images\\/large\\/[A-Za-z0-9-]+\\/[A-Za-z0-9-]+\\.(?:webp|jpe?g|png)/i);
      const title = t ? decode(t[1]).trim() : "";
      return {
        title: title && !/^(404|error|page not found)$/i.test(title) ? title : null,
        date: d ? d[3] + "-" + String(MONTHS.indexOf(d[2]) + 1).padStart(2, "0") + "-" + d[1].padStart(2, "0") : null,
        hero: h ? h[0] : null,
      };
    }
    return null;
  }

  console.log("%c" + (resuming ? "Carrying on with" : "Collecting") + " sale pictures — sales " + at + " to " + TO + ". Type vectisStop() to stop, vectisReset() to start again.", "color:#2AB4A6;font-weight:bold");

  for (; at <= TO && !stopped; at++) {
    const m = await salePage(at);
    if (m === null) { failed.push(at); console.log("%c\\u26a0 sale " + at + " would not load after three tries — noted", "color:#dc2626"); await sleep(PAUSE); continue; }
    if (!m.title && !m.hero) {
      gaps++;
      if (at % 100 === 0) console.log("… at sale " + at + " · " + found + " sales, " + heroes + " pictures so far");
      await sleep(PAUSE); continue;
    }
    sales.push({ siteId: at, title: m.title, date: m.date, hero: m.hero, lots: [] });
    found++;
    if (m.hero) heroes++;
    if (found % 25 === 0) console.log("sale " + at + " · " + (m.title || "(no title)") + " · " + found + " sales, " + heroes + " pictures so far");
    if (sales.length >= PER_FILE) save(at + 1);
    await sleep(PAUSE);
  }

  const finishedRun = at > TO;
  save(finishedRun ? TO + 1 : at);
  if (finishedRun && !failed.length) { try { localStorage.removeItem(KEY); } catch (e) {} }
  console.log("%cFinished — " + found + " sales, " + heroes + " with a cover picture, " + gaps + " numbers with no sale, in " + (part - 1) + " file(s).", "color:#2AB4A6;font-weight:bold");
  if (failed.length) console.log("%c\\u26a0 " + failed.length + " sale(s) would not load: " + failed.join(", ") + ". Run it again to pick them up.", "color:#dc2626;font-weight:bold");
  if (!finishedRun) console.log("Stopped at sale " + at + " — run it again and it carries on from there.");
  console.log("Now load the file(s) on the Hub: Databases → Sales → Get the pictures, then press Copy sale pictures.");
})();`
}

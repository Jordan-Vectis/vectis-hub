// The script that collects the Business Central lots' full descriptions and photo paths from
// vectis.co.uk, pasted into the browser console on an office machine.
//
// ⚠⚠ WHY THIS EXISTS. The website answers our Railway server with **202 and an empty body** for
// every request, while the identical request from a desk in the office returns the lots normally
// (measured 2026-09-09 on two known sales, with browser headers). So the server cannot read the lot
// feed and no change on our side fixes that. Business Central does hold both the photo path and the
// full description, but neither is published anywhere we can read, and Evo-soft development time is
// not available.
//
// ⚠ It writes FILES rather than posting to the Hub. Posting would mean opening a write endpoint to
// the internet with its own token and cross-origin rules; a file needs none of that, can be looked
// at before it is loaded, and picks up where it left off. Each file is capped well under Railway's
// 20 MB body limit — past that the proxy truncates the upload silently, which would look like a
// partial sale rather than a failure.
//
// MEASURED, 2026-09-09 (a full run of this logic collected 216,259 lots from 375 sales):
//   · the site answers **500** for a sale number that does not exist — that is not an error, and
//     the browser logs it in red whatever we do;
//   · sale numbers are sparse — 1450 and 1500 are missing while 1541 exists, so a run must cover
//     its whole range rather than stop after N misses in a row;
//   · Business Central sales run from site number **1062 (B007)** to **1558**, everything below is
//     the old system;
//   · a sale is all one era, so ten lots are enough to tell which — that probe is what stops a run
//     downloading a thousand pre-BC sales in full.
//
// SINCE 2026-09-22 it also reads each sale's own page — title, date and the cover picture the
// website's auction calendar shows — for EVERY sale that exists, old system included (their lots
// are still skipped). One extra request per sale; a run over 1 to 1061 is how the ABC sales get
// their pictures on Databases → Sales.

export const COLLECTOR_FILE_MB = 12
export const BC_FIRST_SITE_SALE = 1062
export const BC_LAST_SITE_SALE = 1558

export function bcCollectorScript(opts: { from: number; to: number }): string {
  const { from, to } = opts
  return `/* Vectis Hub — collect Business Central lots from the website.
   Run this ON www.vectis.co.uk with the console open. It saves files to your Downloads;
   load them on the Hub's BC Database page when it finishes. Safe to stop and re-run. */
(async () => {
  const FROM = ${from};                 // first sale number on the website to look at
  const TO   = ${to};                   // last one
  const MB   = ${COLLECTOR_FILE_MB};    // a new file is saved each time it reaches this size
  const PER  = 500, PAUSE = 250;

  const KEY = "vectisHubCollect";
  const PAGE_URL = "/bidding/0-x-";
  const PAGE_OPTS = { credentials: "same-origin", headers: { "Accept": "text/html,application/xhtml+xml" } };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const isBc = u => /^r\\d+-\\d+$/i.test(String(u == null ? "" : u).trim());
  const codeOf = l => { const m = String((l && l.sef_link) || "").match(/^\\/?bidding\\/([A-Za-z]\\d+)-/); return m ? m[1].toUpperCase() : null; };

  const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } })();
  const resuming = saved && saved.from === FROM && saved.to === TO && saved.next > FROM;
  let at = resuming ? saved.next : FROM;
  let part = resuming ? (saved.part || 1) : 1;

  let sales = [], lots = 0, bytes = 0, bcSales = 0, oldSales = 0, unfinished = 0, gaps = 0, heroes = 0;
  let firstBc = null, lastBc = null, refusals = 0, shortSales = 0, stopped = false, firstWaiting = null;
  const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());   // YYYY-MM-DD
  const failed = [];

  window.vectisStop  = () => { stopped = true; console.log("Stopping after this sale — the file will be saved."); };
  window.vectisReset = () => { localStorage.removeItem(KEY); console.log("Start position cleared — run it again to start from the beginning."); };

  // ⚠ The resume position only ever moves when lots are safely inside a saved FILE. If the tab is
  // closed mid-run it re-collects at most one file's worth, which the Hub de-duplicates, rather
  // than stepping over sales nobody ever saved.
  function remember(next) { try { localStorage.setItem(KEY, JSON.stringify({ from: FROM, to: TO, next: next, part: part })); } catch (e) {} }

  function save(nextId) {
    if (!sales.length) return;
    const name = "vectis-bc-lots-" + String(part).padStart(2, "0") + ".json";
    const blob = new Blob([JSON.stringify({ collectedAt: new Date().toISOString(), sales: sales })], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    console.log("%c\\u2193 Saved " + name + " — " + lots.toLocaleString() + " lots so far", "color:#2AB4A6;font-weight:bold");
    part++; sales = []; bytes = 0;
    remember(nextId);
  }

  // The sale's own page — its title, date and the cover picture the website shows on the auction
  // calendar (one \`auction_images/large/…\` file per sale, ABC and BC alike). One small request per
  // sale; a missing page is just "no picture", never an error.
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"]
  const decode = s => String(s).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/&#(\\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&nbsp;/g, " ")
  const idOf = l => { const m = String(l && l.sef_link || "").match(/^\\/?bidding\\/(\\d+)-/); return m ? Number(m[1]) : null }
  async function salePage(saleId) {
    for (let go = 1; go <= 3; go++) {
      let res
      try { res = await fetch(PAGE_URL + saleId, PAGE_OPTS) }
      catch (e) { await sleep(1500 * go); continue }
      if (res.status === 404 || res.status >= 500) return {}
      if (!res.ok) { await sleep(1500 * go); continue }
      const html = await res.text()
      const t = html.match(/<title>\\s*Vectis Auctions\\s*\\|\\s*([^<]*)<\\/title>/i)
      const d = html.match(/\\b(\\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\\d{4})\\b/)
      const h = html.match(/auction_images\\/large\\/[A-Za-z0-9-]+\\/[A-Za-z0-9-]+\\.(?:webp|jpe?g|png)/i)
      return {
        title: t && !/^(404|error|page not found)$/i.test(decode(t[1]).trim()) ? decode(t[1]).trim() : null,   // the error page has a title too
        date: d ? d[3] + "-" + String(MONTHS.indexOf(d[2]) + 1).padStart(2, "0") + "-" + d[1].padStart(2, "0") : null,
        hero: h ? h[0] : null,
      }
    }
    return {}
  }

  async function feed(saleId, page, per) {
    const body = new URLSearchParams({
      per_page: String(per), current_page: String(page), auction_id: String(saleId),
      lot_order: "", sale_type: "", keyword: "", cate_arr: "[]", sub_cate_arr: "[]",
      extended_attrs_obj: "{}", low_estimate: "", high_estimate: "", catalogue_layout_header_id: "0"
    });
    for (let go = 1; go <= 4; go++) {
      let res;
      try {
        res = await fetch("/index.php?option=com_bidding&format=json&task=commission.getLots", {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/javascript, */*; q=0.01" },
          body: body
        });
      } catch (e) { await sleep(2000 * go); continue; }        // a network hiccup — try again
      if (res.status === 500 || res.status === 404) return null;   // measured: no sale with that number
      if (!res.ok) { await sleep(2000 * go); continue; }       // 429/502/503 — transient, try again
      const text = (await res.text()).trim();
      if (!text) return null;
      try { const j = JSON.parse(text); return Array.isArray(j.lots) ? j : null; }
      catch (e) { refusals++; return null; }
    }
    return null;
  }

  async function readWholeSale(saleId, expected) {
    const all = [];
    for (let page = 1; page <= 80; page++) {
      const j = await feed(saleId, page, PER);
      if (!j || !j.lots.length) break;
      all.push.apply(all, j.lots);
      if (j.lots.length < PER || all.length >= (Number(j.total_lots) || expected)) break;
      await sleep(PAUSE);
    }
    return all;
  }

  console.log("%cCollecting Business Central lots — sales " + at + " to " + TO + "." +
    "\\nRed 500 lines are normal: that is the site saying there is no sale with that number." +
    "\\nType vectisStop() to stop, vectisReset() to start again from the beginning.",
    "color:#2AB4A6;font-weight:bold");

  for (; at <= TO && !stopped; at++) {
    // One small request first. It costs almost nothing and says whether the sale exists and whether
    // it is a Business Central one, so the old sales are skipped instead of downloaded in full.
    const probe = await feed(at, 1, 10);
    if (!probe || !probe.lots.length) {
      gaps++;
      if (at % 50 === 0) console.log("… at sale " + at + " · " + bcSales + " BC sales · " + lots.toLocaleString() + " lots");
      await sleep(PAUSE); continue;
    }
    const code = codeOf(probe.lots[0]) || codeOf(probe.lots[probe.lots.length - 1]);
    // The sale's own page — title, date, cover picture — for EVERY sale that exists, BC or not.
    const meta = await salePage(at);
    const auctionId = idOf(probe.lots[0]);
    const lotCount = Number(probe.total_lots) || probe.lots.length;
    const finishedProbe = probe.lots.every(l => !!l.isFinished);
    const pushMeta = extra => {
      const row = Object.assign({ siteId: at, auctionCode: code, auctionId: auctionId, title: meta.title || null, date: meta.date || null, hero: meta.hero || null, lotCount: lotCount, finished: finishedProbe, lots: [] }, extra);
      sales.push(row); bytes += JSON.stringify(row).length;
      if (meta.hero) heroes++;
      if (bytes > MB * 1048576) save(at + 1);
    };
    if (!probe.lots.some(l => isBc(l.unique_id))) {
      oldSales++;
      pushMeta({});
      if (at % 25 === 0) console.log("… at sale " + at + " · older sales skipped so far: " + oldSales + " (their pictures kept)");
      await sleep(PAUSE); continue;
    }

    // ⚠⚠ FROM HERE ON THE SALE IS KNOWN TO HOLD BC LOTS, so coming away with nothing is a FAILURE,
    // never "no lots". Before this it was silent: one 503 on the heavy per_page=500 request and the
    // whole sale — 600 descriptions that exist nowhere else — vanished with no line printed, no
    // counter moved, and a closing summary that read exactly like a perfect run.
    const expected = Number(probe.total_lots) || 0;
    let all = [];
    for (let go = 1; go <= 3; go++) {
      all = await readWholeSale(at, expected);
      if (all.length) break;
      console.log("%csale " + at + " · " + (code || "?") + " · came back empty, trying again (" + go + " of 3)", "color:#d97706");
      await sleep(5000 * go);
    }
    if (!all.length) {
      failed.push(at + (code ? " (" + code + ")" : ""));
      console.log("%c\\u26a0 sale " + at + " · " + (code || "?") + " · COULD NOT BE READ — it has BC lots but the website would not hand them over. Noted; run again later.", "color:#dc2626;font-weight:bold");
      await sleep(PAUSE); continue;
    }

    // ⚠⚠ Only a sale that has actually been HELD is written — its lots all finished AND its page's
    // date before today in London. The website marks lots isFinished on sales still weeks away
    // (measured 2026-09-25), which let a run take them early and push the Hub's marker past them.
    const held = !!meta.date && meta.date < TODAY;
    const finishedSale = held && all.every(l => !!l.isFinished);
    if (!finishedSale) {
      unfinished++;
      if (firstWaiting === null) firstWaiting = at;
      console.log("sale " + at + " · " + (code || "?") + " · " + (!meta.date ? "no date on its page — not written, run it again later" : !held ? "not held yet (" + meta.date + "), skipped" : "not finished yet, skipped"));
      pushMeta({ finished: false, lotCount: all.length }); await sleep(PAUSE); continue;
    }

    const keep = all.filter(l => isBc(l.unique_id)).map(l => ({
      unique_id: l.unique_id, lot_number: l.lot_number, description: l.description,
      id: l.id, sef_link: l.sef_link, image: l.image, hammer_price: l.hammer_price, sold: l.sold
    }));
    if (keep.length) {
      lots += keep.length;
      bcSales++; if (firstBc === null) firstBc = at; lastBc = at;
      const short = expected && all.length < expected;
      if (short) shortSales++;
      console.log("sale " + at + " · " + (code || "?") + " · " + keep.length + " BC lots" +
        (short ? "  \\u26a0 only got " + all.length + " of " + expected + " — a page did not answer" : ""));
      pushMeta({ lots: keep, lotCount: expected || all.length, finished: true });
    } else pushMeta({ finished: true });
    await sleep(PAUSE);
  }

  const finishedRun = at > TO;
  save(finishedRun ? TO + 1 : at);
  if (finishedRun && !failed.length) { try { localStorage.removeItem(KEY); } catch (e) {} } else { remember(finishedRun ? TO + 1 : at); }

  console.log("%cFinished — " + lots.toLocaleString() + " BC lots from " + bcSales + " sales and " + heroes + " sale cover pictures, in " + (part - 1) + " file(s).",
    "color:#2AB4A6;font-weight:bold");
  console.log("BC sales ran from site number " + (firstBc === null ? "—" : firstBc) + " to " + (lastBc === null ? "—" : lastBc) +
    " · " + oldSales + " older sales skipped · " + unfinished + " not finished · " + gaps + " numbers with no sale" +
    (shortSales ? " · \\u26a0 " + shortSales + " sale(s) came back short" : "") +
    (refusals ? " · \\u26a0 " + refusals + " unreadable replies" : ""));
  if (firstWaiting !== null) console.log("%cNEXT TIME START FROM SALE " + firstWaiting + " — the first sale in this range that has not been held yet.", "color:#d97706;font-weight:bold");
  if (failed.length) console.log("%c\\u26a0 " + failed.length + " sale(s) could NOT be read and are missing: " + failed.join(", ") + ". Run it again to pick them up.", "color:#dc2626;font-weight:bold");
  if (!finishedRun) console.log("Stopped at sale " + at + " — run it again and it carries on from there.");
  console.log("Now load the file(s) on the Hub: Databases → BC Database → Load lot files.");
})();`
}

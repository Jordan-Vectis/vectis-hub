// Who owns a customer's record — Business Central, or the Hub. SERVER ONLY.
//
// Jordan, 2026-10-23: "BC first: Goods In picks from the BC customers; new people are created in BC
// then copied in. Build it so the Hub can take over at switch day." So until switch day:
//   • nobody adds or edits a customer's details in the Hub (the nightly copy would write BC's version
//     back over them anyway) — Goods In picks from the 208,000 BC customers, and a new person is made
//     in BC, then fetched with "Fetch new customers from BC" or the nightly copy;
//   • the one exception is a Submissions enquiry from someone BC has never heard of: that makes a
//     Hub "prospect" (Customer.source = "hub", no C-number), which the copy ADOPTS by email the day BC
//     gets them (lib/customer-sync.ts), so nothing is ever typed twice.
// On switch day set CUSTOMERS_OWNER=hub on Railway: the forms open up and the Hub is the record.

export const HUB_OWNS_CUSTOMERS = process.env.CUSTOMERS_OWNER === "hub"

export const BC_OWNS_MESSAGE =
  "Customers' details are kept in Business Central until the Hub takes over — make the change in BC, then press Fetch new customers from BC (or wait for tonight's copy)."

// The same switch for the WAREHOUSE records (2026-10-23 — Jordan: "a similar thing for warehouse …
// ready for a transition so one day that is taken over in the hub"). BC's receipts and totes are
// copied INTO Goods In's own tables nightly (lib/goods-in/bc-mirror.ts, source "bc"); until switch
// day they are read-only in the Hub — no editing, adding to, printing, closing or MOVING a BC tote
// here, because BC wouldn't know and the next copy would write BC's version back. On switch day set
// WAREHOUSE_OWNER=hub on Railway and Goods In treats them as its own.
export const HUB_OWNS_WAREHOUSE = process.env.WAREHOUSE_OWNER === "hub"

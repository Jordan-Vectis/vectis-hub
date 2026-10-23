// Goods In → one receipt: the shapes the server page hands to its client parts. Plain data only
// (dates as ISO strings), so nothing here pulls server code into the browser.

/** The <datalist> of categories already in use, rendered once by the page and shared by every category box on it. */
export const CATEGORY_LIST_ID = "gi-receipt-categories"

export type LotView = {
  id: string
  barcode: string | null
  title: string
  auctionId: string
  auctionCode: string | null
  auctionName: string | null
  /** False when the viewer's departments don't cover that sale — the code shows, the link doesn't. */
  canOpenSale: boolean
  /** The lot's shelf: its latest Goods In move, if it has one. */
  shelf: string | null
  shelvedAt: string | null
}

export type ContainerView = {
  id: string
  kind: string
  category: string | null
  description: string | null
  status: string | null
  locationCode: string | null
  locationKind: string | null
  locationName: string | null
  movedAt: string | null
  labelPrintedAt: string | null
  createdAt: string
  /** Changes on every save — lets a row show what was just saved until the page's fresh copy arrives. */
  updatedAt: string
  createdByName: string | null
  /** "bc" when copied from Business Central (read-only until the Hub takes over). */
  source: string | null
  lots: LotView[]
}

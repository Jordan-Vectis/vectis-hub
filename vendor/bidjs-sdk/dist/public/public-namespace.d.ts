import { HttpClient } from '../http/http-client';
import { ModelResource } from './model/model';
import { AuctionResource } from './auction/auction';
import { TokenResource } from './token/token';
import { RegisterForAuctionResource } from './registerForAuction/registerForAuction';
import { TimedNamespace } from './timed/timedNamespace';
import { HomeResource } from './home/home';
/**
 * Namespace providing access to all BidJS public resources.
 *
 * Uses the `x-forwarded-client-id` header for client identification.
 * Access via `sdk.public`.
 *
 * @example
 * ```ts
 * const bidjs = new BidJS({ ... })
 * const auction = await bidjs.public.auction.v3.get('auction-uuid')
 * const home = await bidjs.public.home.v1.get()
 * ```
 */
export declare class PublicNamespace {
    /** Core blade configuration — currency, timezone, and client settings. */
    readonly models: ModelResource;
    /** Auction retrieval — fetch full auction data by UUID. */
    readonly auction: AuctionResource;
    /** Authentication — login with username and password. */
    readonly token: TokenResource;
    /** Auction registration — view registration page and submit registrations. */
    readonly registerForAuction: RegisterForAuctionResource;
    /** Timed bidding — place bids and auto-bids on timed auction items. */
    readonly timed: TimedNamespace;
    /** Home page — upcoming auctions and landing page data. */
    readonly home: HomeResource;
    constructor(httpClient: HttpClient);
}
//# sourceMappingURL=public-namespace.d.ts.map
import { HttpClient } from '../../http/http-client';
import { BidResource } from './bid/bid';
import { AutoBidResource } from './autoBid/autoBid';
/**
 * Namespace grouping timed auction bidding resources.
 *
 * Provides access to standard bids and auto-bids (proxy bids) for timed
 * auction items. Access via `sdk.public.timed`.
 */
export declare class TimedNamespace {
    /** Standard timed bids — place a single bid at a specific amount. */
    readonly bid: BidResource;
    /** Auto-bids (proxy bids) — automatically bid up to a maximum amount. */
    readonly autoBid: AutoBidResource;
    constructor(httpClient: HttpClient);
}
//# sourceMappingURL=timedNamespace.d.ts.map
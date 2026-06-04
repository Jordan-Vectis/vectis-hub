"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimedNamespace = void 0;
const bid_1 = require("./bid/bid");
const autoBid_1 = require("./autoBid/autoBid");
/**
 * Namespace grouping timed auction bidding resources.
 *
 * Provides access to standard bids and auto-bids (proxy bids) for timed
 * auction items. Access via `sdk.public.timed`.
 */
class TimedNamespace {
    constructor(httpClient) {
        this.bid = new bid_1.BidResource(httpClient);
        this.autoBid = new autoBid_1.AutoBidResource(httpClient);
    }
}
exports.TimedNamespace = TimedNamespace;
//# sourceMappingURL=timedNamespace.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PublicNamespace = void 0;
const model_1 = require("./model/model");
const auction_1 = require("./auction/auction");
const token_1 = require("./token/token");
const registerForAuction_1 = require("./registerForAuction/registerForAuction");
const timedNamespace_1 = require("./timed/timedNamespace");
const home_1 = require("./home/home");
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
class PublicNamespace {
    constructor(httpClient) {
        this.models = new model_1.ModelResource(httpClient);
        this.auction = new auction_1.AuctionResource(httpClient);
        this.token = new token_1.TokenResource(httpClient);
        this.registerForAuction = new registerForAuction_1.RegisterForAuctionResource(httpClient);
        this.timed = new timedNamespace_1.TimedNamespace(httpClient);
        this.home = new home_1.HomeResource(httpClient);
    }
}
exports.PublicNamespace = PublicNamespace;
//# sourceMappingURL=public-namespace.js.map
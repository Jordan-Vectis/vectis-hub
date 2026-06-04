"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuctionResource = void 0;
const strip_class_fields_1 = require("../../http/strip-class-fields");
/**
 * Public resource for retrieving auction details.
 *
 * Returns full auction data including items, sale statuses, and categories
 * for a single auction. Access via `sdk.public.auction`.
 */
class AuctionResource {
    constructor(httpClient) {
        this.v3 = {
            async get(uuid) {
                const encoded = encodeURIComponent(uuid);
                const raw = await httpClient.get(`/auction-007/api/v3/auctions/${encoded}`);
                return (0, strip_class_fields_1.stripFields)(raw, ['apiKey', 'token']);
            }
        };
    }
}
exports.AuctionResource = AuctionResource;
//# sourceMappingURL=auction.js.map
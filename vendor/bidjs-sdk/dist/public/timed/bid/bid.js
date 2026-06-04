"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BidResource = void 0;
const strip_class_fields_1 = require("../../../http/strip-class-fields");
/**
 * Public resource for placing timed bids.
 *
 * Places a standard bid on a timed auction item. The user must be registered
 * for the auction before bidding. Access via `sdk.public.timed.bid`.
 */
class BidResource {
    constructor(httpClient) {
        this.v1 = {
            async post(itemId, registrantId, userId, amount) {
                const path = `/auction-007/api/v1/timed/bid/${encodeURIComponent(itemId)}/${encodeURIComponent(registrantId)}/${encodeURIComponent(userId)}/${encodeURIComponent(amount)}`;
                const raw = await httpClient.post(path, {});
                return (0, strip_class_fields_1.stripFields)((0, strip_class_fields_1.stripClassFields)(raw), ['password']);
            }
        };
    }
}
exports.BidResource = BidResource;
//# sourceMappingURL=bid.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutoBidResource = void 0;
const strip_class_fields_1 = require("../../../http/strip-class-fields");
/**
 * Public resource for placing timed auto-bids (proxy bids).
 *
 * Places an automatic bid that will incrementally bid on behalf of the user
 * up to the specified maximum amount. The user must be registered for the
 * auction before bidding. Access via `sdk.public.timed.autoBid`.
 */
class AutoBidResource {
    constructor(httpClient) {
        this.v1 = {
            async post(itemId, registrantId, userId, amount) {
                const path = `/auction-007/api/v1/timed/autobid/${encodeURIComponent(itemId)}/${encodeURIComponent(registrantId)}/${encodeURIComponent(userId)}/${encodeURIComponent(amount)}`;
                const raw = await httpClient.post(path, {});
                return (0, strip_class_fields_1.stripFields)((0, strip_class_fields_1.stripClassFields)(raw), ['password']);
            }
        };
    }
}
exports.AutoBidResource = AutoBidResource;
//# sourceMappingURL=autoBid.js.map
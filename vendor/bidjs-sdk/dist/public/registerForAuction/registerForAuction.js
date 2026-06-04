"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RegisterForAuctionResource = void 0;
const strip_class_fields_1 = require("../../http/strip-class-fields");
/**
 * Public resource for auction registration.
 *
 * Provides the registration page data and handles registration submissions.
 * Both endpoints require authentication — the user must be logged in via
 * the token endpoint first. Access via `sdk.public.registerForAuction`.
 */
class RegisterForAuctionResource {
    constructor(httpClient) {
        this.v2 = {
            async get(auctionUuid) {
                const encoded = encodeURIComponent(auctionUuid);
                const raw = await httpClient.get(`/auction-007/api/v2/registerForAuction/${encoded}`);
                return (0, strip_class_fields_1.stripClassFields)(raw);
            },
            async post(request) {
                return httpClient.post('/auction-007/api/v2/registerForAuction', request);
            }
        };
    }
}
exports.RegisterForAuctionResource = RegisterForAuctionResource;
//# sourceMappingURL=registerForAuction.js.map
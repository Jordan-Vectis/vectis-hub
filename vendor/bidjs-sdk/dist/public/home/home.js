"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HomeResource = void 0;
const strip_class_fields_1 = require("../../http/strip-class-fields");
/**
 * Public resource for retrieving the home page data.
 *
 * Returns upcoming auctions and their items for the home/landing page.
 * Access via `sdk.public.home`.
 */
class HomeResource {
    constructor(httpClient) {
        this.v1 = {
            async get() {
                const raw = await httpClient.get('/auction-007/api/v1/home');
                return (0, strip_class_fields_1.stripClassFields)(raw);
            }
        };
    }
}
exports.HomeResource = HomeResource;
//# sourceMappingURL=home.js.map
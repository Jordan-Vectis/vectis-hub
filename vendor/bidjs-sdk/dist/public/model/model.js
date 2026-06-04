"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelResource = void 0;
const strip_class_fields_1 = require("../../http/strip-class-fields");
/**
 * Public resource for retrieving the core blade configuration model.
 *
 * Returns platform configuration including currency settings, timezone,
 * and client branding. Access via `sdk.public.models`.
 */
class ModelResource {
    constructor(httpClient) {
        this.v1 = {
            async get() {
                const raw = await httpClient.get('/auction-007/api/v1/models');
                const stripped = (0, strip_class_fields_1.stripClassFields)(raw);
                return (0, strip_class_fields_1.stripFields)(stripped, [
                    'apiKeys',
                    'password',
                    'phoneVerificationEnabled',
                    'phoneVerificationUrl',
                    'phoneVerificationBrand',
                    'phoneVerificationApiKey',
                    'phoneVerificationApiSecret'
                ]);
            }
        };
    }
}
exports.ModelResource = ModelResource;
//# sourceMappingURL=model.js.map
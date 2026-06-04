"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenResource = void 0;
const strip_class_fields_1 = require("../../http/strip-class-fields");
/**
 * Public resource for user authentication.
 *
 * Authenticates a user by username and password, returning user details
 * and a token for authenticated endpoints. Access via `sdk.public.token`.
 */
class TokenResource {
    constructor(httpClient) {
        this.v1 = {
            async post(credentials) {
                const payload = {
                    '@class': 'com.bidlogix.scaffold.models.user.LoginModel',
                    ...credentials
                };
                const raw = await httpClient.post('/auction-007/api/v1/token', payload);
                return (0, strip_class_fields_1.stripFields)((0, strip_class_fields_1.stripClassFields)(raw), ['password']);
            }
        };
    }
}
exports.TokenResource = TokenResource;
//# sourceMappingURL=token.js.map
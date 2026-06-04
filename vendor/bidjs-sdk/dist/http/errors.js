"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BidJSHttpError = exports.BidJSError = void 0;
class BidJSError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BidJSError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
exports.BidJSError = BidJSError;
class BidJSHttpError extends BidJSError {
    constructor(statusCode, responseBody) {
        super(`API request failed with status ${statusCode}`);
        this.name = 'BidJSHttpError';
        this.statusCode = statusCode;
        this.responseBody = responseBody;
    }
}
exports.BidJSHttpError = BidJSHttpError;
//# sourceMappingURL=errors.js.map
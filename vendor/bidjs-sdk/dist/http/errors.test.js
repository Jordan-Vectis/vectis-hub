"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const errors_1 = require("./errors");
describe('BidJSError', () => {
    it('should be an instance of Error', () => {
        const error = new errors_1.BidJSError('test error');
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(errors_1.BidJSError);
    });
    it('should have the correct name and message', () => {
        const error = new errors_1.BidJSError('something went wrong');
        expect(error.name).toBe('BidJSError');
        expect(error.message).toBe('something went wrong');
    });
});
describe('BidJSHttpError', () => {
    it('should be an instance of BidJSError and Error', () => {
        const error = new errors_1.BidJSHttpError(404, 'Not Found');
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(errors_1.BidJSError);
        expect(error).toBeInstanceOf(errors_1.BidJSHttpError);
    });
    it('should have the correct properties', () => {
        const error = new errors_1.BidJSHttpError(500, '{"error":"Internal Server Error"}');
        expect(error.name).toBe('BidJSHttpError');
        expect(error.statusCode).toBe(500);
        expect(error.responseBody).toBe('{"error":"Internal Server Error"}');
        expect(error.message).toBe('API request failed with status 500');
    });
});
//# sourceMappingURL=errors.test.js.map
export declare class BidJSError extends Error {
    constructor(message: string);
}
export declare class BidJSHttpError extends BidJSError {
    readonly statusCode: number;
    readonly responseBody: string;
    constructor(statusCode: number, responseBody: string);
}
//# sourceMappingURL=errors.d.ts.map
import { BidJSConfig } from './types/config';
import { PublicNamespace } from './public/public-namespace';
import { SocketNamespace } from './websocket';
/**
 * Main entry point for the BidJS SDK.
 *
 * Each instance is bound to a single `clientId`, `language`.
 * Authentication state set via {@link setAccessToken} is stored on the instance.
 *
 * **Important:** Do not share a single `BidJS` instance across multiple users.
 * In server-side environments, create one instance per user/request context to
 * avoid token mix-ups between concurrent requests.
 */
export declare class BidJS {
    private readonly publicClient;
    readonly public: PublicNamespace;
    readonly socket: SocketNamespace;
    constructor(config: BidJSConfig);
    setAccessToken(token: string): void;
    clearAccessToken(): void;
}
export default BidJS;
export { BidJSConfig } from './types/config';
export { Country, Address, ApiResponse, ErrorModel, UnauthorizedError, CurrencyModel, TimeZoneModel, ClientOptionsModel, LanguageModel, UserAddressModel, AttachmentModel, OfferModel, AuctioneerModel, UserModel } from './types/common';
export { BidJSError, BidJSHttpError } from './http/errors';
export { HttpClient } from './http/http-client';
export { buildPublicBaseUrl } from './http/url-builder';
export { PublicNamespace } from './public/public-namespace';
export { ModelResource } from './public/model/model';
export { AuctionResource } from './public/auction/auction';
export { TokenResource } from './public/token/token';
export { RegisterForAuctionResource } from './public/registerForAuction/registerForAuction';
export { TimedNamespace } from './public/timed/timedNamespace';
export { BidResource } from './public/timed/bid/bid';
export { AutoBidResource } from './public/timed/autoBid/autoBid';
export { HomeResource } from './public/home/home';
export { WebSocketClient } from './websocket/webSocketClient';
export { SocketNamespace } from './websocket/socketNamespace';
export * from './public/model/model.types';
export * from './public/auction/auction.types';
export * from './public/token/token.types';
export * from './public/registerForAuction/registerForAuction.types';
export * from './public/timed/timed.types';
export * from './public/home/home.types';
//# sourceMappingURL=index.d.ts.map
import { HttpClient } from '../../http/http-client';
import { AuctionResponse } from './auction.types';
/**
 * Public resource for retrieving auction details.
 *
 * Returns full auction data including items, sale statuses, and categories
 * for a single auction. Access via `sdk.public.auction`.
 */
export declare class AuctionResource {
    /**
     * v3 auction endpoints.
     *
     * @example
     * ```ts
     * const auction = await bidjs.public.auction.v3.get('550e8400-...')
     * console.log(auction.auction.title)
     * console.log(auction.listings) // items in the auction
     * ```
     */
    readonly v3: {
        /**
         * Retrieves a single auction by UUID.
         *
         * @param uuid - The auction UUID.
         * @returns Full auction response including auction details, listings, sales, sale statuses, and categories.
         */
        get(uuid: string): Promise<AuctionResponse>;
    };
    constructor(httpClient: HttpClient);
}
//# sourceMappingURL=auction.d.ts.map
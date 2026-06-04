import { HttpClient } from '../../../http/http-client';
import { TimedResponse } from '../timed.types';
/**
 * Public resource for placing timed bids.
 *
 * Places a standard bid on a timed auction item. The user must be registered
 * for the auction before bidding. Access via `sdk.public.timed.bid`.
 */
export declare class BidResource {
    /**
     * v1 timed bid endpoints.
     *
     * @example
     * ```ts
     * const result = await bidjs.public.timed.bid.v1.post(
     *   456,    // itemId
     *   789,    // registrantId
     *   123,    // userId
     *   150.00  // bid amount
     * )
     * console.log(result.success)
     * ```
     */
    readonly v1: {
        /**
         * Places a timed bid on an item.
         *
         * @param itemId - The numeric item ID.
         * @param registrantId - The numeric registrant ID (from auction registration).
         * @param userId - The numeric user ID.
         * @param amount - The bid amount.
         * @returns Timed response indicating the bid result.
         */
        post(itemId: number, registrantId: number, userId: number, amount: number): Promise<TimedResponse>;
    };
    constructor(httpClient: HttpClient);
}
//# sourceMappingURL=bid.d.ts.map
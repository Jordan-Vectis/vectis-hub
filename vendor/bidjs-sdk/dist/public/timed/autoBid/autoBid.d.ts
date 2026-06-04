import { HttpClient } from '../../../http/http-client';
import { TimedResponse } from '../timed.types';
/**
 * Public resource for placing timed auto-bids (proxy bids).
 *
 * Places an automatic bid that will incrementally bid on behalf of the user
 * up to the specified maximum amount. The user must be registered for the
 * auction before bidding. Access via `sdk.public.timed.autoBid`.
 */
export declare class AutoBidResource {
    /**
     * v1 timed auto-bid endpoints.
     *
     * @example
     * ```ts
     * const result = await bidjs.public.timed.autoBid.v1.post(
     *   456,    // itemId
     *   789,    // registrantId
     *   123,    // userId
     *   500.00  // maximum auto-bid amount
     * )
     * console.log(result.success)
     * ```
     */
    readonly v1: {
        /**
         * Places a timed auto-bid (proxy bid) on an item.
         *
         * @param itemId - The numeric item ID.
         * @param registrantId - The numeric registrant ID (from auction registration).
         * @param userId - The numeric user ID.
         * @param amount - The maximum auto-bid amount.
         * @returns Timed response indicating the auto-bid result.
         */
        post(itemId: number, registrantId: number, userId: number, amount: number): Promise<TimedResponse>;
    };
    constructor(httpClient: HttpClient);
}
//# sourceMappingURL=autoBid.d.ts.map
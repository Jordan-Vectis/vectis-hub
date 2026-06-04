import { HttpClient } from '../../http/http-client';
import { RegisterForAuctionRequest, RegisterForAuctionResponse, RegistrationPageResponse } from './registerForAuction.types';
/**
 * Public resource for auction registration.
 *
 * Provides the registration page data and handles registration submissions.
 * Both endpoints require authentication — the user must be logged in via
 * the token endpoint first. Access via `sdk.public.registerForAuction`.
 */
export declare class RegisterForAuctionResource {
    /**
     * v2 registration endpoints.
     *
     * @example
     * ```ts
     * // Fetch registration page (requires auth)
     * const page = await bidjs.public.registerForAuction.v2.get('auction-uuid')
     * console.log(page.registrant) // existing registration or null
     *
     * // Submit registration (requires auth)
     * const result = await bidjs.public.registerForAuction.v2.post({
     *   auctionUuid: 'auction-uuid',
     *   userUuid: 'user-uuid',
     *   termsAgreed: true
     * })
     * ```
     */
    readonly v2: {
        /**
         * Retrieves the registration page for an auction.
         *
         * @param auctionUuid - The auction UUID to get registration details for.
         * @returns Registration page response including auction details and any existing registrant status.
         */
        get(auctionUuid: string): Promise<RegistrationPageResponse>;
        /**
         * Submits a registration request for an auction.
         *
         * @param request - The registration request containing auction UUID, user UUID, and terms agreement.
         * @returns Registration response confirming the registration status.
         */
        post(request: RegisterForAuctionRequest): Promise<RegisterForAuctionResponse>;
    };
    constructor(httpClient: HttpClient);
}
//# sourceMappingURL=registerForAuction.d.ts.map
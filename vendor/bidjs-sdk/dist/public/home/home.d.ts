import { HttpClient } from '../../http/http-client';
import { HomeResponse } from './home.types';
/**
 * Public resource for retrieving the home page data.
 *
 * Returns upcoming auctions and their items for the home/landing page.
 * Access via `sdk.public.home`.
 */
export declare class HomeResource {
    /**
     * v1 home endpoints.
     *
     * @example
     * ```ts
     * const home = await bidjs.public.home.v1.get()
     * console.log(home.upcomingAuctions)
     * ```
     */
    readonly v1: {
        /**
         * Retrieves the home page data including upcoming auctions.
         *
         * @returns Home response with upcoming auctions, their listings, and sale data.
         */
        get(): Promise<HomeResponse>;
    };
    constructor(httpClient: HttpClient);
}
//# sourceMappingURL=home.d.ts.map
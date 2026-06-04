import { HttpClient } from '../../http/http-client';
import { CoreBladeModel } from './model.types';
/**
 * Public resource for retrieving the core blade configuration model.
 *
 * Returns platform configuration including currency settings, timezone,
 * and client branding. Access via `sdk.public.models`.
 */
export declare class ModelResource {
    /**
     * v1 model endpoints.
     *
     * @example
     * ```ts
     * const model = await bidjs.public.models.v1.get()
     * console.log(model.currencyCode)
     * console.log(model.timezone)
     * ```
     */
    readonly v1: {
        /**
         * Retrieves the core blade model for the configured client.
         *
         * @returns Core blade model with platform configuration, currency, timezone, and branding.
         */
        get(): Promise<CoreBladeModel>;
    };
    constructor(httpClient: HttpClient);
}
//# sourceMappingURL=model.d.ts.map
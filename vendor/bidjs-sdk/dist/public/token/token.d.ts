import { HttpClient } from '../../http/http-client';
import { LoginCredentials, AuthenticatedUserModel } from './token.types';
/**
 * Public resource for user authentication.
 *
 * Authenticates a user by username and password, returning user details
 * and a token for authenticated endpoints. Access via `sdk.public.token`.
 */
export declare class TokenResource {
    /**
     * v1 token endpoints.
     *
     * @example
     * ```ts
     * const user = await bidjs.public.token.v1.post({
     *   username: 'buyer@example.com',
     *   password: 's3cret'
     * })
     * console.log(user.uuid)   // user UUID for authenticated calls
     * console.log(user.userId) // numeric user ID
     * ```
     */
    readonly v1: {
        /**
         * Authenticates a user with login credentials.
         *
         * @param credentials - The user's login credentials (username and password).
         * @returns Authenticated user model with user details, UUID, and token.
         */
        post(credentials: LoginCredentials): Promise<AuthenticatedUserModel>;
    };
    constructor(httpClient: HttpClient);
}
//# sourceMappingURL=token.d.ts.map
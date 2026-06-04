export interface HttpClientConfig {
    baseUrl: string;
    headers: Record<string, string>;
}
export declare class HttpClient {
    private readonly baseUrl;
    private readonly headers;
    constructor(config: HttpClientConfig);
    setAccessToken(token: string): void;
    clearAccessToken(): void;
    get<T>(path: string): Promise<T>;
    post<T>(path: string, body: unknown): Promise<T>;
    patch<T>(path: string, body: unknown): Promise<T>;
    delete<T>(path: string, body?: unknown): Promise<T>;
    private parseResponse;
}
//# sourceMappingURL=http-client.d.ts.map
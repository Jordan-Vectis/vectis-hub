import { WebSocketClient } from './webSocketClient';
/**
 * Namespace providing access to the WebSocket client.
 *
 * Acts as a factory that creates and caches a single {@link WebSocketClient}
 * instance configured with the broadcast endpoint. Access via `sdk.public.websocket`.
 *
 * @example
 * ```ts
 * const ws = bidjs.public.websocket.client()
 * await ws.connect()
 * ws.subscribe('auction-uuid')
 * ```
 */
export declare class SocketNamespace {
    private readonly broadcastEndpoint;
    private instance;
    constructor(broadcastEndpoint: string);
    /**
     * Returns the WebSocket client instance.
     *
     * Creates the client on first call; subsequent calls return the same instance.
     *
     * @returns The configured {@link WebSocketClient}.
     */
    client(): WebSocketClient;
}
//# sourceMappingURL=socketNamespace.d.ts.map
import type { WebSocketClientConfig, SubscribeOptions, SocketEventMap } from './types';
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
/**
 * Real-time WebSocket client for receiving live auction events.
 *
 * Connects to the BidJS broadcast server and emits typed events for bids,
 * sale updates, and registration changes. Supports automatic reconnection
 * with exponential backoff and built-in ping/pong heartbeats.
 *
 * Obtain an instance via `bidjs.socket.client()`.
 *
 * @example
 * ```ts
 * const ws = bidjs.socket.client()
 *
 * ws.on('BID_PLACED', (event) => {
 *   console.log(event.bid.amount)
 * })
 *
 * await ws.connect()
 * ws.subscribe('auction-uuid', { userUuid: 'user-uuid' })
 * ```
 */
export declare class WebSocketClient {
    private readonly config;
    private readonly emitter;
    private readonly pingManager;
    private readonly reconnectManager;
    private readonly subscriptions;
    private ws;
    private intentionalClose;
    private state;
    private connectTimeoutId;
    private connectReject;
    private connectPromise;
    constructor(config: WebSocketClientConfig);
    /**
     * Opens the WebSocket connection.
     *
     * Resolves when the connection is established. Rejects on timeout (10s),
     * if the socket closes during the handshake, or if {@link disconnect} is
     * called before the connection opens.
     *
     * If already connected, resolves immediately. If a connection attempt is
     * already in progress, returns the same in-flight promise — resolving when
     * the handshake completes rather than immediately.
     */
    connect(): Promise<void>;
    /**
     * Closes the WebSocket connection and clears all subscriptions.
     *
     * Prevents automatic reconnection. If called during a connection handshake,
     * the pending {@link connect} promise is rejected immediately. Emits the
     * `disconnected` lifecycle event. Call {@link connect} to re-establish.
     */
    disconnect(): void;
    /**
     * Subscribes to real-time events for an auction.
     *
     * If already connected, the subscription message is sent immediately.
     * If not yet connected, subscriptions are queued and sent on connect.
     * Subscriptions are automatically restored after reconnection.
     *
     * @param auctionUuid - The auction UUID to subscribe to.
     * @param options - Optional subscribe options. Pass `userUuid` to receive user-specific events.
     */
    subscribe(auctionUuid: string, options?: SubscribeOptions): void;
    /**
     * Registers a listener for a specific event.
     *
     * @param event - The event name (e.g. `'BID_PLACED'`, `'connected'`, `'error'`).
     * @param listener - Callback invoked with the typed event payload.
     */
    on<K extends keyof SocketEventMap>(event: K, listener: (data: SocketEventMap[K]) => void): void;
    /**
     * Registers a one-time listener that is removed after the first invocation.
     *
     * @param event - The event name.
     * @param listener - Callback invoked once with the typed event payload.
     */
    once<K extends keyof SocketEventMap>(event: K, listener: (data: SocketEventMap[K]) => void): void;
    /**
     * Removes a previously registered listener.
     *
     * @param event - The event name.
     * @param listener - The listener function to remove.
     */
    off<K extends keyof SocketEventMap>(event: K, listener: (data: SocketEventMap[K]) => void): void;
    /** Whether the WebSocket is currently in a `'connected'` state. */
    get isConnected(): boolean;
    /** The current connection state: `'disconnected'`, `'connecting'`, `'connected'`, or `'reconnecting'`. */
    get connectionState(): ConnectionState;
    private send;
    private handleMessage;
    private handlePingTimeout;
    private resubscribe;
    private attemptReconnect;
}
export {};
//# sourceMappingURL=webSocketClient.d.ts.map
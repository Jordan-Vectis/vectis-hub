"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketClient = void 0;
const typedEventEmitter_1 = require("./typedEventEmitter");
const pingManager_1 = require("./pingManager");
const reconnectManager_1 = require("./reconnectManager");
const serializer_1 = require("./serializer");
const CONNECT_TIMEOUT_MS = 10000;
const DOMAIN_EVENTS = new Set([
    'BID_PLACED',
    'SALE_COMPLETED',
    'SALE_ADDED',
    'SALE_WITHDRAWN',
    'REGISTRANT_UPDATED'
]);
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
class WebSocketClient {
    constructor(config) {
        this.emitter = new typedEventEmitter_1.TypedEventEmitter();
        this.subscriptions = new Map();
        this.ws = null;
        this.intentionalClose = false;
        this.state = 'disconnected';
        this.connectTimeoutId = null;
        this.connectReject = null;
        this.connectPromise = null;
        this.config = {
            url: config.url,
            reconnect: true,
            reconnectStrategy: 'exponential',
            maxReconnectAttempts: 5,
            pingIntervalMs: 6000,
            pongTimeoutMs: 4500
        };
        this.pingManager = new pingManager_1.PingManager({
            intervalMs: this.config.pingIntervalMs,
            timeoutMs: this.config.pongTimeoutMs
        });
        this.reconnectManager = new reconnectManager_1.ReconnectManager({
            strategy: this.config.reconnectStrategy,
            maxAttempts: this.config.maxReconnectAttempts
        });
    }
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
    connect() {
        if (this.state === 'connected') {
            return Promise.resolve();
        }
        if (this.connectPromise) {
            return this.connectPromise;
        }
        this.connectPromise = new Promise((resolve, reject) => {
            this.intentionalClose = false;
            this.state = 'connecting';
            this.connectTimeoutId = setTimeout(() => {
                this.connectTimeoutId = null;
                this.connectReject = null;
                this.connectPromise = null;
                if (this.ws) {
                    this.ws.onclose = null;
                    this.ws.onmessage = null;
                    this.ws.onerror = null;
                    this.ws.onopen = null;
                    this.ws.close();
                    this.ws = null;
                }
                this.state = 'disconnected';
                reject(new Error('Connection timeout'));
            }, CONNECT_TIMEOUT_MS);
            this.connectReject = reject;
            this.ws = new WebSocket(this.config.url);
            this.ws.onopen = () => {
                if (this.connectTimeoutId) {
                    clearTimeout(this.connectTimeoutId);
                    this.connectTimeoutId = null;
                }
                this.connectReject = null;
                this.connectPromise = null;
                this.state = 'connected';
                this.reconnectManager.reset();
                this.pingManager.start(() => this.send((0, serializer_1.buildPingMessage)()), () => this.handlePingTimeout());
                this.resubscribe();
                this.emitter.emit('connected', undefined);
                resolve();
            };
            this.ws.onmessage = (event) => {
                this.handleMessage(String(event.data));
            };
            this.ws.onclose = (event) => {
                if (this.connectTimeoutId) {
                    clearTimeout(this.connectTimeoutId);
                    this.connectTimeoutId = null;
                }
                this.connectPromise = null;
                this.pingManager.stop();
                if (this.state === 'connecting') {
                    this.state = 'disconnected';
                    const rej = this.connectReject;
                    this.connectReject = null;
                    rej?.(new Error(`WebSocket closed during connect: ${event.code}`));
                    return;
                }
                this.state = 'disconnected';
                this.emitter.emit('disconnected', { code: event.code, reason: event.reason });
                if (!this.intentionalClose && this.config.reconnect) {
                    this.attemptReconnect();
                }
            };
            this.ws.onerror = () => {
                this.emitter.emit('error', new Error('WebSocket error'));
            };
        });
        return this.connectPromise;
    }
    /**
     * Closes the WebSocket connection and clears all subscriptions.
     *
     * Prevents automatic reconnection. If called during a connection handshake,
     * the pending {@link connect} promise is rejected immediately. Emits the
     * `disconnected` lifecycle event. Call {@link connect} to re-establish.
     */
    disconnect() {
        this.intentionalClose = true;
        this.reconnectManager.stop();
        this.pingManager.stop();
        this.subscriptions.clear();
        this.connectPromise = null;
        if (this.connectTimeoutId) {
            clearTimeout(this.connectTimeoutId);
            this.connectTimeoutId = null;
        }
        if (this.connectReject) {
            this.connectReject(new Error('Disconnected during connect'));
            this.connectReject = null;
        }
        if (this.ws) {
            this.ws.onmessage = null;
            this.ws.onerror = null;
            this.ws.onopen = null;
            // onclose is kept intentionally so the 'disconnected' event fires
            this.ws.close();
            this.ws = null;
        }
        this.state = 'disconnected';
    }
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
    subscribe(auctionUuid, options) {
        const opts = options ?? {};
        this.subscriptions.set(auctionUuid, opts);
        if (this.state === 'connected' && this.ws) {
            this.ws.send((0, serializer_1.buildSubscribeMessage)(auctionUuid, opts.userUuid));
        }
    }
    /**
     * Registers a listener for a specific event.
     *
     * @param event - The event name (e.g. `'BID_PLACED'`, `'connected'`, `'error'`).
     * @param listener - Callback invoked with the typed event payload.
     */
    on(event, listener) {
        this.emitter.on(event, listener);
    }
    /**
     * Registers a one-time listener that is removed after the first invocation.
     *
     * @param event - The event name.
     * @param listener - Callback invoked once with the typed event payload.
     */
    once(event, listener) {
        this.emitter.once(event, listener);
    }
    /**
     * Removes a previously registered listener.
     *
     * @param event - The event name.
     * @param listener - The listener function to remove.
     */
    off(event, listener) {
        this.emitter.off(event, listener);
    }
    /** Whether the WebSocket is currently in a `'connected'` state. */
    get isConnected() {
        return this.state === 'connected';
    }
    /** The current connection state: `'disconnected'`, `'connecting'`, `'connected'`, or `'reconnecting'`. */
    get connectionState() {
        return this.state;
    }
    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(data);
        }
    }
    handleMessage(raw) {
        const message = (0, serializer_1.parseMessage)(raw);
        if (!message)
            return;
        if (message.action === 'PONG') {
            this.pingManager.receivedPong();
            this.emitter.emit('pong', undefined);
            return;
        }
        if (message.action === 'AUCTION_SUBSCRIBED') {
            this.emitter.emit('AUCTION_SUBSCRIBED', message.data);
            return;
        }
        if (DOMAIN_EVENTS.has(message.action)) {
            this.emitter.emit(message.action, message.data);
        }
    }
    handlePingTimeout() {
        if (this.ws) {
            this.ws.close();
        }
    }
    resubscribe() {
        for (const [auctionUuid, opts] of this.subscriptions) {
            if (this.ws) {
                this.ws.send((0, serializer_1.buildSubscribeMessage)(auctionUuid, opts.userUuid));
            }
        }
    }
    attemptReconnect() {
        this.state = 'reconnecting';
        const scheduled = this.reconnectManager.scheduleReconnect(() => {
            this.emitter.emit('reconnecting', {
                attempt: this.reconnectManager.attempts,
                maxAttempts: this.config.maxReconnectAttempts
            });
            this.connect().catch(() => {
                if (!this.intentionalClose && this.config.reconnect) {
                    this.attemptReconnect();
                }
            });
        });
        if (!scheduled) {
            this.state = 'disconnected';
            this.emitter.emit('error', new Error('Max reconnect attempts reached'));
        }
    }
}
exports.WebSocketClient = WebSocketClient;
//# sourceMappingURL=webSocketClient.js.map
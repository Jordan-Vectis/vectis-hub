"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocketNamespace = void 0;
const webSocketClient_1 = require("./webSocketClient");
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
class SocketNamespace {
    constructor(broadcastEndpoint) {
        this.instance = null;
        this.broadcastEndpoint = broadcastEndpoint;
    }
    /**
     * Returns the WebSocket client instance.
     *
     * Creates the client on first call; subsequent calls return the same instance.
     *
     * @returns The configured {@link WebSocketClient}.
     */
    client() {
        if (!this.instance) {
            this.instance = new webSocketClient_1.WebSocketClient({
                url: this.broadcastEndpoint
            });
        }
        return this.instance;
    }
}
exports.SocketNamespace = SocketNamespace;
//# sourceMappingURL=socketNamespace.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const socketNamespace_1 = require("./socketNamespace");
const webSocketClient_1 = require("./webSocketClient");
const index_1 = require("./index");
jest.mock('./webSocketClient');
const MockWebSocketClient = webSocketClient_1.WebSocketClient;
beforeEach(() => {
    MockWebSocketClient.mockClear();
});
describe('websocket barrel re-exports', () => {
    it('should export WebSocketClient and SocketNamespace', () => {
        expect(index_1.WebSocketClient).toBeDefined();
        expect(index_1.SocketNamespace).toBeDefined();
    });
});
describe('SocketNamespace', () => {
    it('should create a WebSocketClient with the broadcast endpoint on first call', () => {
        const namespace = new socketNamespace_1.SocketNamespace('wss://broadcast.eu-west-2.bidjs.com');
        namespace.client();
        expect(MockWebSocketClient).toHaveBeenCalledTimes(1);
        expect(MockWebSocketClient).toHaveBeenCalledWith({ url: 'wss://broadcast.eu-west-2.bidjs.com' });
    });
    it('should return the same instance on subsequent calls', () => {
        const namespace = new socketNamespace_1.SocketNamespace('wss://broadcast.eu-west-2.bidjs.com');
        const first = namespace.client();
        const second = namespace.client();
        expect(MockWebSocketClient).toHaveBeenCalledTimes(1);
        expect(first).toBe(second);
    });
});
//# sourceMappingURL=socketNamespace.test.js.map
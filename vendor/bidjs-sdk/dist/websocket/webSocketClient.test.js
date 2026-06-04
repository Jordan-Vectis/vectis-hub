"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const webSocketClient_1 = require("./webSocketClient");
let mockWsInstance;
const MockWebSocket = jest.fn().mockImplementation(() => {
    mockWsInstance = {
        onopen: null,
        onclose: null,
        onmessage: null,
        onerror: null,
        send: jest.fn(),
        close: jest.fn(),
        readyState: 1
    };
    return mockWsInstance;
});
Object.defineProperty(MockWebSocket, 'OPEN', { value: 1 });
Object.defineProperty(MockWebSocket, 'CLOSED', { value: 3 });
global.WebSocket = MockWebSocket;
function simulateOpen() {
    mockWsInstance.onopen({});
}
function simulateClose(code = 1000, reason = '') {
    mockWsInstance.onclose({ code, reason });
}
function simulateMessage(data) {
    mockWsInstance.onmessage({ data: JSON.stringify(data) });
}
function simulateError() {
    mockWsInstance.onerror({});
}
beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0);
    MockWebSocket.mockClear();
});
afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});
describe('WebSocketClient', () => {
    describe('connect', () => {
        it('should resolve when WebSocket opens', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const connectPromise = client.connect();
            simulateOpen();
            await expect(connectPromise).resolves.toBeUndefined();
            expect(client.isConnected).toBe(true);
            expect(client.connectionState).toBe('connected');
            client.disconnect();
        });
        it('should reject on connection timeout', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const connectPromise = client.connect();
            jest.advanceTimersByTime(10000);
            await expect(connectPromise).rejects.toThrow('Connection timeout');
            expect(client.connectionState).toBe('disconnected');
        });
        it('should not trigger reconnect after connection timeout', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const reconnectingFn = jest.fn();
            client.on('reconnecting', reconnectingFn);
            const connectPromise = client.connect();
            jest.advanceTimersByTime(10000);
            await expect(connectPromise).rejects.toThrow('Connection timeout');
            // Advance well past any reconnect delay — no reconnect should happen
            jest.advanceTimersByTime(30000);
            expect(reconnectingFn).not.toHaveBeenCalled();
            expect(MockWebSocket).toHaveBeenCalledTimes(1);
        });
        it('should reject when WebSocket closes during connect', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const connectPromise = client.connect();
            simulateClose(1006);
            await expect(connectPromise).rejects.toThrow('WebSocket closed during connect: 1006');
        });
        it('should pass url to WebSocket constructor', () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://broadcast.eu-west-2.bidjs.com/' });
            client.connect().catch(() => { });
            expect(MockWebSocket).toHaveBeenCalledWith('wss://broadcast.eu-west-2.bidjs.com/');
            client.disconnect();
        });
        it('should resolve immediately and not create a new socket if already connected', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const connectPromise = client.connect();
            simulateOpen();
            await connectPromise;
            const secondConnect = client.connect();
            await expect(secondConnect).resolves.toBeUndefined();
            // Only one WebSocket should ever have been created
            expect(MockWebSocket).toHaveBeenCalledTimes(1);
            client.disconnect();
        });
        it('should return the in-flight promise to concurrent callers while connecting', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const firstConnect = client.connect();
            expect(client.connectionState).toBe('connecting');
            // Second caller gets the exact same promise — no new socket created
            const secondConnect = client.connect();
            expect(secondConnect).toBe(firstConnect);
            expect(MockWebSocket).toHaveBeenCalledTimes(1);
            // Both callers resolve together when the socket opens
            simulateOpen();
            await expect(firstConnect).resolves.toBeUndefined();
            await expect(secondConnect).resolves.toBeUndefined();
            client.disconnect();
        });
    });
    describe('disconnect', () => {
        it('should close cleanly and not trigger reconnect', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const reconnectingFn = jest.fn();
            client.on('reconnecting', reconnectingFn);
            const connectPromise = client.connect();
            simulateOpen();
            await connectPromise;
            client.disconnect();
            jest.advanceTimersByTime(30000);
            expect(reconnectingFn).not.toHaveBeenCalled();
            expect(client.connectionState).toBe('disconnected');
            expect(client.isConnected).toBe(false);
        });
        it('should reject the connect() promise immediately when disconnect() is called during handshake', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const connectPromise = client.connect();
            expect(client.connectionState).toBe('connecting');
            // Disconnect before the handshake completes — should reject immediately, not after 10s timeout
            client.disconnect();
            await expect(connectPromise).rejects.toThrow('Disconnected during connect');
            expect(client.connectionState).toBe('disconnected');
            // Confirm the 10s timeout does not fire and produce a second rejection
            jest.advanceTimersByTime(10000);
        });
        it('should emit disconnected when called on an established connection', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const disconnectedFn = jest.fn();
            client.on('disconnected', disconnectedFn);
            const connectPromise = client.connect();
            simulateOpen();
            await connectPromise;
            client.disconnect();
            // The real WebSocket fires onclose when close() is called — simulate that here.
            // onclose is still attached to the mock instance even after this.ws is nulled.
            simulateClose(1000, '');
            expect(disconnectedFn).toHaveBeenCalledTimes(1);
            expect(disconnectedFn).toHaveBeenCalledWith({ code: 1000, reason: '' });
        });
    });
    describe('subscribe', () => {
        it('should send unauthenticated subscribe message with id null', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const connectPromise = client.connect();
            simulateOpen();
            await connectPromise;
            client.subscribe('c1e39006-eb40-4228-bc1d-2d0ab4d4adc4');
            const calls = mockWsInstance.send.mock.calls;
            const sent = JSON.parse(calls[calls.length - 1][0]);
            expect(sent).toEqual({
                action: 'SubscribeToAuction',
                data: 'c1e39006-eb40-4228-bc1d-2d0ab4d4adc4',
                id: null
            });
            client.disconnect();
        });
        it('should send authenticated subscribe message with user UUID', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const connectPromise = client.connect();
            simulateOpen();
            await connectPromise;
            client.subscribe('c1e39006-eb40-4228-bc1d-2d0ab4d4adc4', {
                userUuid: 'd549d023-419d-415d-b96e-3f766a94c054'
            });
            const calls = mockWsInstance.send.mock.calls;
            const sent = JSON.parse(calls[calls.length - 1][0]);
            expect(sent).toEqual({
                action: 'SubscribeToAuction',
                data: 'c1e39006-eb40-4228-bc1d-2d0ab4d4adc4',
                id: 'd549d023-419d-415d-b96e-3f766a94c054'
            });
            client.disconnect();
        });
        it('should store subscription and send when connected later', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            client.subscribe('c1e39006-eb40-4228-bc1d-2d0ab4d4adc4');
            const connectPromise = client.connect();
            simulateOpen();
            await connectPromise;
            const calls = mockWsInstance.send.mock.calls;
            const sent = JSON.parse(calls[calls.length - 1][0]);
            expect(sent).toEqual({
                action: 'SubscribeToAuction',
                data: 'c1e39006-eb40-4228-bc1d-2d0ab4d4adc4',
                id: null
            });
            client.disconnect();
        });
    });
    describe('event routing', () => {
        it('should emit BID_PLACED with typed payload', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const listener = jest.fn();
            client.on('BID_PLACED', listener);
            const connectPromise = client.connect();
            simulateOpen();
            await connectPromise;
            const payload = {
                auctionUuid: 'a1',
                bid: { amount: 100, uuid: 'b1', listingUuid: 'l1', userUuid: 'u1', live: true, cancelled: false, onlineBidderOrigin: true, autobid: false, placedAt: 123 },
                saleStatus: { endsAt: 456, inOvertimeBidding: false, highestBidUuid: 'b1', highestOfferUuid: null, complete: false, preview: false, sold: false, withdrawn: false, suspended: false, listingUuid: 'l1', webcastStateId: null },
                sale: { listingUuid: 'l1', bids: ['b1'], purchaseTypeId: 1, incrementValue: 10, nextBidValue: 110, nextBidCalculation: null, numberOfUnits: 1, unitOfMeasurement: null, buyNowValue: null, biddingTypeId: 1, reserve: 50, currencyCode: 'GBP', hammerTaxRate: 0, chargesTaxRate: 0, buyersPremium: 15, buyersPremiumTaxRate: 20, charges: 0 }
            };
            simulateMessage({ action: 'BID_PLACED', data: payload });
            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith(payload);
            client.disconnect();
        });
        it('should emit SALE_COMPLETED with typed payload', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const listener = jest.fn();
            client.on('SALE_COMPLETED', listener);
            const connectPromise = client.connect();
            simulateOpen();
            await connectPromise;
            const payload = { auctionUuid: 'a1', saleStatus: { complete: true, listingUuid: 'l1', endsAt: 0, inOvertimeBidding: false, highestBidUuid: null, highestOfferUuid: null, preview: false, sold: true, withdrawn: false, suspended: false, webcastStateId: null }, sale: { listingUuid: 'l1', bids: [], purchaseTypeId: 1, incrementValue: 10, nextBidValue: 0, nextBidCalculation: null, numberOfUnits: 1, unitOfMeasurement: null, buyNowValue: null, biddingTypeId: 1, reserve: 0, currencyCode: 'GBP', hammerTaxRate: 0, chargesTaxRate: 0, buyersPremium: 0, buyersPremiumTaxRate: 0, charges: 0 } };
            simulateMessage({ action: 'SALE_COMPLETED', data: payload });
            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith(payload);
            client.disconnect();
        });
        it('should emit SALE_ADDED with typed payload', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const listener = jest.fn();
            client.on('SALE_ADDED', listener);
            const connectPromise = client.connect();
            simulateOpen();
            await connectPromise;
            const payload = { auctionUuid: 'a1', clientId: 'c1', listings: {}, sales: {}, saleStatuses: {}, attachments: {} };
            simulateMessage({ action: 'SALE_ADDED', data: payload });
            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith(payload);
            client.disconnect();
        });
        it('should emit SALE_WITHDRAWN with typed payload', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const listener = jest.fn();
            client.on('SALE_WITHDRAWN', listener);
            const connectPromise = client.connect();
            simulateOpen();
            await connectPromise;
            const payload = { auctionUuid: 'a1', clientId: 'c1', listings: {}, sales: {}, saleStatuses: {} };
            simulateMessage({ action: 'SALE_WITHDRAWN', data: payload });
            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith(payload);
            client.disconnect();
        });
        it('should emit REGISTRANT_UPDATED with typed payload', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const listener = jest.fn();
            client.on('REGISTRANT_UPDATED', listener);
            const connectPromise = client.connect();
            simulateOpen();
            await connectPromise;
            const payload = { auctionUuid: 'a1', registrant: { uuid: 'r1', id: 1, approved: true, userUuid: 'u1', countryCode: 'GB', county: 'Sussex', city: 'Lewes', paddleNumber: 42, auctionUuid: 'a1', statusLabel: 'Approved' } };
            simulateMessage({ action: 'REGISTRANT_UPDATED', data: payload });
            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith(payload);
            client.disconnect();
        });
        it('should emit AUCTION_SUBSCRIBED with auction UUID', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const listener = jest.fn();
            client.on('AUCTION_SUBSCRIBED', listener);
            const connectPromise = client.connect();
            simulateOpen();
            await connectPromise;
            simulateMessage({ action: 'AUCTION_SUBSCRIBED', data: 'c1e39006-eb40-4228-bc1d-2d0ab4d4adc4' });
            expect(listener).toHaveBeenCalledWith('c1e39006-eb40-4228-bc1d-2d0ab4d4adc4');
            client.disconnect();
        });
        it('should handle PONG internally without emitting', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const connectPromise = client.connect();
            simulateOpen();
            await connectPromise;
            // Advance to trigger a ping
            jest.advanceTimersByTime(6000);
            // Send pong - should not throw or emit
            expect(() => simulateMessage({ action: 'PONG', data: '' })).not.toThrow();
            // Advance past pong timeout - no error should occur since pong was received
            jest.advanceTimersByTime(5000);
            expect(client.isConnected).toBe(true);
            client.disconnect();
        });
        it('should ignore messages with unknown actions', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const errorFn = jest.fn();
            client.on('error', errorFn);
            const connectPromise = client.connect();
            simulateOpen();
            await connectPromise;
            expect(() => simulateMessage({ action: 'UNKNOWN_ACTION', data: {} })).not.toThrow();
            expect(errorFn).not.toHaveBeenCalled();
            client.disconnect();
        });
        it('should silently drop unparseable messages', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const errorFn = jest.fn();
            client.on('error', errorFn);
            const connectPromise = client.connect();
            simulateOpen();
            await connectPromise;
            // Send raw invalid JSON directly — parseMessage returns null, should not throw
            expect(() => mockWsInstance.onmessage({ data: 'not-valid-json' })).not.toThrow();
            expect(errorFn).not.toHaveBeenCalled();
            client.disconnect();
        });
    });
    describe('lifecycle events', () => {
        it('should emit connected on open', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const listener = jest.fn();
            client.on('connected', listener);
            const connectPromise = client.connect();
            simulateOpen();
            await connectPromise;
            expect(listener).toHaveBeenCalledTimes(1);
            client.disconnect();
        });
        it('should emit disconnected on close', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const listener = jest.fn();
            client.on('disconnected', listener);
            const connectPromise = client.connect();
            simulateOpen();
            await connectPromise;
            simulateClose(1000, 'normal');
            expect(listener).toHaveBeenCalledWith({ code: 1000, reason: 'normal' });
            client.disconnect();
        });
        it('should emit error on WebSocket error', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const listener = jest.fn();
            client.on('error', listener);
            const connectPromise = client.connect();
            simulateOpen();
            await connectPromise;
            simulateError();
            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener.mock.calls[0][0]).toBeInstanceOf(Error);
            client.disconnect();
        });
    });
    describe('reconnect', () => {
        it('should attempt reconnection on unexpected close', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const connectPromise = client.connect();
            simulateOpen();
            await connectPromise;
            expect(client.connectionState).toBe('connected');
            // Simulate unexpected close
            simulateClose(1006, 'abnormal');
            expect(client.connectionState).toBe('reconnecting');
            // Advance past constant delay
            jest.advanceTimersByTime(1000);
            // A new WebSocket should have been created
            expect(MockWebSocket).toHaveBeenCalledTimes(2);
            client.disconnect();
        });
        it('should re-subscribe to tracked auctions after reconnect', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const connectPromise = client.connect();
            simulateOpen();
            await connectPromise;
            client.subscribe('auction-1');
            client.subscribe('auction-2', { userUuid: 'user-1' });
            // Clear send calls from initial subscribe
            mockWsInstance.send.mockClear();
            // Simulate unexpected close and reconnect
            simulateClose(1006);
            jest.advanceTimersByTime(1000);
            // New WebSocket created - simulate open
            simulateOpen();
            // Should have re-sent both subscriptions
            const sentMessages = mockWsInstance.send.mock.calls.map((call) => JSON.parse(call[0]));
            expect(sentMessages).toContainEqual({
                action: 'SubscribeToAuction',
                data: 'auction-1',
                id: null
            });
            expect(sentMessages).toContainEqual({
                action: 'SubscribeToAuction',
                data: 'auction-2',
                id: 'user-1'
            });
            client.disconnect();
        });
        it('should not reconnect after intentional disconnect', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const connectPromise = client.connect();
            simulateOpen();
            await connectPromise;
            client.disconnect();
            jest.advanceTimersByTime(30000);
            // Only the initial connection
            expect(MockWebSocket).toHaveBeenCalledTimes(1);
        });
        it('should emit error when max reconnect attempts reached', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const errorFn = jest.fn();
            client.on('error', errorFn);
            const connectPromise = client.connect();
            simulateOpen();
            await connectPromise;
            // Exhaust all 5 reconnect attempts (exponential: 1s, 2s, 4s, 8s, 16s; jitter=0 via Math.random mock)
            simulateClose(1006);
            jest.advanceTimersByTime(1000); // attempt 1 fires
            simulateClose(1006);
            await Promise.resolve();
            jest.advanceTimersByTime(2000); // attempt 2 fires
            simulateClose(1006);
            await Promise.resolve();
            jest.advanceTimersByTime(4000); // attempt 3 fires
            simulateClose(1006);
            await Promise.resolve();
            jest.advanceTimersByTime(8000); // attempt 4 fires
            simulateClose(1006);
            await Promise.resolve();
            jest.advanceTimersByTime(16000); // attempt 5 fires
            simulateClose(1006);
            await Promise.resolve();
            expect(errorFn).toHaveBeenCalledWith(expect.objectContaining({
                message: 'Max reconnect attempts reached'
            }));
            client.disconnect();
        });
        it('should emit reconnecting event before each attempt', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const reconnectingFn = jest.fn();
            client.on('reconnecting', reconnectingFn);
            const connectPromise = client.connect();
            simulateOpen();
            await connectPromise;
            simulateClose(1006);
            jest.advanceTimersByTime(1000);
            expect(reconnectingFn).toHaveBeenCalledWith({
                attempt: 1,
                maxAttempts: 5
            });
            client.disconnect();
        });
    });
    describe('off', () => {
        it('should remove a specific listener', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const listener = jest.fn();
            client.on('BID_PLACED', listener);
            const connectPromise = client.connect();
            simulateOpen();
            await connectPromise;
            simulateMessage({ action: 'BID_PLACED', data: { auctionUuid: 'a1' } });
            expect(listener).toHaveBeenCalledTimes(1);
            client.off('BID_PLACED', listener);
            simulateMessage({ action: 'BID_PLACED', data: { auctionUuid: 'a2' } });
            expect(listener).toHaveBeenCalledTimes(1);
            client.disconnect();
        });
    });
    describe('once', () => {
        it('should fire once then auto-remove', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const listener = jest.fn();
            client.once('AUCTION_SUBSCRIBED', listener);
            const connectPromise = client.connect();
            simulateOpen();
            await connectPromise;
            simulateMessage({ action: 'AUCTION_SUBSCRIBED', data: 'auction-1' });
            simulateMessage({ action: 'AUCTION_SUBSCRIBED', data: 'auction-2' });
            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith('auction-1');
            client.disconnect();
        });
    });
    describe('ping/pong', () => {
        it('should close connection when pong timeout occurs', async () => {
            const client = new webSocketClient_1.WebSocketClient({ url: 'wss://test.com' });
            const connectPromise = client.connect();
            simulateOpen();
            await connectPromise;
            // Trigger ping
            jest.advanceTimersByTime(6000);
            // Don't send pong - wait for timeout (hardcoded 4500ms)
            jest.advanceTimersByTime(4500);
            expect(mockWsInstance.close).toHaveBeenCalled();
            client.disconnect();
        });
    });
});
//# sourceMappingURL=webSocketClient.test.js.map
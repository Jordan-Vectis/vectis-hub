"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const serializer_1 = require("./serializer");
describe('serializer', () => {
    describe('parseMessage', () => {
        it('should parse valid JSON with action field', () => {
            const raw = JSON.stringify({ action: 'PONG', data: '' });
            const result = (0, serializer_1.parseMessage)(raw);
            expect(result).toEqual({ action: 'PONG', data: '' });
        });
        it('should parse message with all fields', () => {
            const raw = JSON.stringify({
                action: 'BID_PLACED',
                uuid: null,
                timestamp: 1770980410587,
                data: { bid: { amount: 100 } }
            });
            const result = (0, serializer_1.parseMessage)(raw);
            expect(result).toEqual({
                action: 'BID_PLACED',
                uuid: null,
                timestamp: 1770980410587,
                data: { bid: { amount: 100 } }
            });
        });
        it('should return null for malformed JSON', () => {
            const result = (0, serializer_1.parseMessage)('not valid json{');
            expect(result).toBeNull();
        });
        it('should return null for JSON missing action field', () => {
            const raw = JSON.stringify({ data: 'something' });
            const result = (0, serializer_1.parseMessage)(raw);
            expect(result).toBeNull();
        });
        it('should return null for JSON with non-string action', () => {
            const raw = JSON.stringify({ action: 123 });
            const result = (0, serializer_1.parseMessage)(raw);
            expect(result).toBeNull();
        });
    });
    describe('buildSubscribeMessage', () => {
        it('should build unauthenticated subscribe message with id null', () => {
            const result = (0, serializer_1.buildSubscribeMessage)('c1e39006-eb40-4228-bc1d-2d0ab4d4adc4');
            expect(JSON.parse(result)).toEqual({
                action: 'SubscribeToAuction',
                data: 'c1e39006-eb40-4228-bc1d-2d0ab4d4adc4',
                id: null
            });
        });
        it('should build authenticated subscribe message with user UUID', () => {
            const result = (0, serializer_1.buildSubscribeMessage)('c1e39006-eb40-4228-bc1d-2d0ab4d4adc4', 'd549d023-419d-415d-b96e-3f766a94c054');
            expect(JSON.parse(result)).toEqual({
                action: 'SubscribeToAuction',
                data: 'c1e39006-eb40-4228-bc1d-2d0ab4d4adc4',
                id: 'd549d023-419d-415d-b96e-3f766a94c054'
            });
        });
    });
    describe('buildPingMessage', () => {
        it('should build correct ping message', () => {
            const result = (0, serializer_1.buildPingMessage)();
            expect(JSON.parse(result)).toEqual({ action: 'Ping' });
        });
    });
});
//# sourceMappingURL=serializer.test.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseMessage = parseMessage;
exports.buildSubscribeMessage = buildSubscribeMessage;
exports.buildPingMessage = buildPingMessage;
function parseMessage(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.action !== 'string') {
            return null;
        }
        return parsed;
    }
    catch {
        return null;
    }
}
function buildSubscribeMessage(auctionUuid, userUuid) {
    return JSON.stringify({
        action: 'SubscribeToAuction',
        data: auctionUuid,
        id: userUuid ?? null
    });
}
function buildPingMessage() {
    return JSON.stringify({ action: 'Ping' });
}
//# sourceMappingURL=serializer.js.map
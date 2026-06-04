export interface InboundMessage {
    action: string;
    data?: unknown;
    uuid?: string | null;
    timestamp?: number;
}
export declare function parseMessage(raw: string): InboundMessage | null;
export declare function buildSubscribeMessage(auctionUuid: string, userUuid?: string): string;
export declare function buildPingMessage(): string;
//# sourceMappingURL=serializer.d.ts.map
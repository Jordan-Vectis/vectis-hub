import { Address } from '../types/common';
export interface WebSocketClientConfig {
    url: string;
}
export interface SubscribeOptions {
    userUuid?: string;
}
export interface Attachment {
    uuid: string;
    label: string;
    basePath: string;
    versionAndPublicId: string;
    size: number;
}
export interface Bid {
    amount: number;
    uuid: string;
    listingUuid: string;
    userUuid: string;
    live: boolean;
    cancelled: boolean;
    onlineBidderOrigin: boolean;
    autobid: boolean;
    placedAt: number;
}
export interface SaleStatus {
    endsAt: number;
    inOvertimeBidding: boolean;
    highestBidUuid: string | null;
    highestOfferUuid: string | null;
    complete: boolean;
    preview: boolean;
    sold: boolean;
    withdrawn: boolean;
    suspended: boolean;
    listingUuid: string;
    webcastStateId: number | null;
}
export interface Sale {
    listingUuid: string;
    bids: string[];
    purchaseTypeId: number;
    incrementValue: number;
    nextBidValue: number;
    nextBidCalculation: string | null;
    numberOfUnits: number;
    unitOfMeasurement: string | null;
    buyNowValue: number | null;
    biddingTypeId: number;
    reserve: number;
    currencyCode: string;
    hammerTaxRate: number;
    chargesTaxRate: number;
    buyersPremium: number;
    buyersPremiumTaxRate: number;
    charges: number;
}
export interface Listing {
    uuid: string;
    id: number;
    auctionIndex: number;
    title: string;
    description: string | null;
    summary: string | null;
    lotNumber: string;
    images: string[];
    documents: string[];
    videos: string[];
    categoryUuid: string;
    type: string;
    countryCode: string;
    contactSeller: boolean;
    auctionUuid: string;
    buyersPremium: number;
    charges: number;
    buyersPremiumTaxRate: number;
    chargesTaxRate: number;
    hammerTaxRate: number;
    address: Address;
    marketplace: boolean;
    grouped: boolean;
    groupedItems: string[];
    choiceId: string | null;
    minimumChoice: number | null;
}
export interface BidPlacedEvent {
    auctionUuid: string;
    bid: Bid;
    saleStatus: SaleStatus;
    sale: Sale;
}
export interface SaleCompletedEvent {
    auctionUuid: string;
    clientId?: string;
    saleStatus: SaleStatus;
    sale: Sale;
}
export interface SaleAddedEvent {
    auctionUuid: string;
    clientId: string;
    listings: Record<string, Listing>;
    sales: Record<string, Sale>;
    saleStatuses: Record<string, SaleStatus>;
    attachments: Record<string, Attachment>;
}
export interface SaleWithdrawnEvent {
    auctionUuid: string;
    clientId: string;
    listings: Record<string, Listing>;
    sales: Record<string, Sale>;
    saleStatuses: Record<string, SaleStatus>;
    attachments?: Record<string, Attachment>;
}
export interface Registrant {
    uuid: string;
    id: number;
    approved: boolean;
    userUuid: string;
    countryCode: string;
    county: string;
    city: string;
    paddleNumber: number;
    auctionUuid: string;
    statusLabel: string;
}
export interface RegistrantUpdatedEvent {
    auctionUuid: string;
    registrant: Registrant;
}
export interface AuctionServerEvents {
    BID_PLACED: BidPlacedEvent;
    SALE_COMPLETED: SaleCompletedEvent;
    SALE_ADDED: SaleAddedEvent;
    SALE_WITHDRAWN: SaleWithdrawnEvent;
    REGISTRANT_UPDATED: RegistrantUpdatedEvent;
    AUCTION_SUBSCRIBED: string;
}
export interface LifecycleEvents {
    connected: void;
    disconnected: {
        code: number;
        reason: string;
    };
    reconnecting: {
        attempt: number;
        maxAttempts: number;
    };
    pong: void;
    error: Error;
}
export type SocketEventMap = AuctionServerEvents & LifecycleEvents;
//# sourceMappingURL=types.d.ts.map
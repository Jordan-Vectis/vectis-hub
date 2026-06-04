import { Address, OfferModel } from '../../types/common';
export interface Auction {
    uuid: string;
    logoUuid: string | null;
    activeListings: string[];
    id: number;
    live: boolean;
    webcast: boolean;
    title: string;
    endsAt: number | null;
    startsAt: number;
    status: string;
}
export interface Listing {
    uuid: string;
    id: number;
    auctionIndex: number;
    title: string;
    description: string;
    summary: string;
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
    choiceId: number | null;
    minimumChoice: number | null;
}
export interface CategoryChild {
    uuid: string;
    id: number;
    name: string;
    parentUuid: string;
}
export interface CategoryParent {
    uuid: string;
    id: number;
    name: string;
    treeUuid: string;
    children: string[];
}
export interface CategoryTree {
    uuid: string;
    name: string;
}
export interface Categories {
    children: Record<string, CategoryChild>;
    parents: Record<string, CategoryParent>;
    trees: Record<string, CategoryTree>;
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
export interface SaleInformation {
    description: string;
    collectionInformation: string;
    contactInformation: string;
    removalInformation: string;
    paymentInformation: string;
    termsAndConditionsInformation: string;
    documents: string[];
    currencyCode: string;
    buyersPremiumPercentage: number;
    buyersPremiumTaxRate: number;
    hammerTaxRate: number;
    chargesTaxRate: number;
    viewingDates: boolean;
    viewingStartDateTime: number | null;
    viewingEndDateTime: number | null;
    appointmentRequiredForViewing: boolean;
    viewingInstruction: string;
    clearanceDates: boolean;
    clearanceStartDateTime: number | null;
    clearanceEndDateTime: number | null;
    clearanceInstructions: string;
    address: string;
    locationLatitude: string;
    locationLongitude: string;
    timeZoneCode: string;
    catalogueUrl: string | null;
    preBidding: boolean;
    salesTaxRequired: boolean;
}
export interface Configuration {
    hideRelatedItems: boolean;
    showWinningBid: boolean;
    showNumberOfBids: boolean;
    showBiddingEndDate: boolean;
    showAutoBidOnly: boolean;
    maximumOffersPerItem: number;
    showSaleInfoPage: boolean;
    showItemLocation: boolean;
    itemLimitPerPage: number;
    buyNowCutoff: number;
    showBidIncrements: boolean;
}
export interface AuctionInformation {
    auction: Auction;
    listings: Record<string, Listing>;
    categories: Categories;
    registrants: Record<string, Registrant>;
    saleInformation: SaleInformation;
    configuration: Configuration;
    starredItems: string[];
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
export interface SellingListingInfo {
    listingUuid: string;
    bids: string[];
    purchaseTypeId: number;
    incrementValue: number | null;
    nextBidValue: number | null;
    nextBidCalculation: string | null;
    numberOfUnits: number;
    unitOfMeasurement: string | null;
    buyNowValue: number | null;
    biddingTypeId: number | null;
    reserve: number | null;
    currencyCode: string;
    hammerTaxRate: number;
    chargesTaxRate: number;
    buyersPremium: number;
    buyersPremiumTaxRate: number;
    charges: number;
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
export interface MaxBidModel {
    uuid: string;
    listingUuid: string;
    userUuid: string;
    value: number;
    message: string;
}
export interface SellingInformation {
    bids: Record<string, Bid>;
    offers: Record<string, OfferModel>;
    sales: Record<string, SellingListingInfo>;
    saleStatuses: Record<string, SaleStatus>;
    maxBids: Record<string, MaxBidModel>;
    purchaseTypes: Record<string, string>;
}
export interface Attachment {
    uuid: string;
    label: string | null;
    basePath: string | null;
    versionAndPublicId: string;
    size: number;
}
export interface WebcastFeed {
    auctionUuid: string;
    sessionId: string | null;
}
export interface WebcastInPlay {
    auctionUuid: string;
    listingUuid: string;
    warningCount: number;
    paused: boolean;
}
export interface MessageModel {
    uuid: string;
    popup: boolean;
    text: string;
    userUuid: string;
    typeId: number;
    listingUuid: string;
}
export interface WebcastInformation {
    feed: WebcastFeed;
    inPlay: WebcastInPlay;
    messages: MessageModel[];
}
interface BaseAuctionResponse {
    information: AuctionInformation;
    sellingInformation: SellingInformation;
    attachments: Record<string, Attachment>;
}
export interface TimedAuctionResponse extends BaseAuctionResponse {
    webcastInformation: null;
}
export interface WebcastAuctionResponse extends BaseAuctionResponse {
    webcastInformation: WebcastInformation;
}
export type AuctionResponse = TimedAuctionResponse | WebcastAuctionResponse;
export {};
//# sourceMappingURL=auction.types.d.ts.map
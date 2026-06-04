import { CurrencyModel, TimeZoneModel, ClientOptionsModel, UserModel, OfferModel } from '../../types/common';
export interface TimedResponse {
    worked: boolean;
    itemId: number;
    actionCode: number;
    uid: number | null;
    userId: number | null;
    models: TimedResponseModels;
}
export interface TimedResponseModels {
    BiddingItemModel: BiddingItemModel;
    TimedUserInfoModel: TimedUserInfoModel;
}
export interface BiddingItemModel {
    id: number;
    listingUuid: string;
    timedBiddingInfo: TimedBiddingInfoModel;
    timedUserInfo: TimedUserInfoModel | null;
    localeSensitive: LocaleSensitiveModel;
    buyersPremium: number;
    itemType: ItemTypeModel;
    watchers: UserModel[] | null;
    clientOptions: ClientOptionsModel;
    category: CategoryModel;
    inPreBidding: boolean;
    preBiddingEnabled: boolean;
    dateAuctionStarts: number;
    lotNumber: string;
    localeInternal: string;
    auctionId: number;
    registrant: UserRegistrationModel | null;
    recentlyAdded: boolean;
    watching: boolean;
    archived: boolean;
    showFlags: boolean;
    uiShowItemRoundels: boolean;
    showBiddingButton: boolean;
    firstImage: string | null;
    fullExternalWebpageUrl: string | null;
    timeZone: TimeZoneModel;
    itemDetailsAvailable: boolean;
    auctionUuid: string;
}
export interface TimedBiddingInfoModel {
    itemId: number;
    ofBulkBuyType: boolean;
    version: number;
    statusId: number;
    publicVisible: boolean;
    highestBid: number;
    highestBidUuid: string | null;
    highestOfferUuid: string | null;
    increment: number;
    openingBid: number;
    numberOfBids: number;
    reserve: number;
    reserveReached: boolean;
    overtimeBidding: boolean;
    buyNowEnabled: boolean;
    makeOfferEnabled: boolean;
    transferEnabled: boolean;
    tenderEnabled: boolean;
    tenderPctEnabled: boolean;
    purchaseCutoff: number;
    contactSellerEnabled: boolean;
    minimumOfferOrBuyNowPrice: number;
    unitOfMeasurement: string | null;
    highestBidUID: number;
    highestBidPlacedAt: number | null;
    highestBidHasAutobid: boolean;
    highestBidReserve: boolean;
    offerAccepted: boolean;
    purchaseOption: string | null;
    numberOfUnits: number;
    itemCount: number;
    numberOfUnitsRemaining: number;
    biddingType: number;
    biddingTypePerLot: boolean;
    biddingTypePerUnit: boolean;
    endTime: number;
    actualEndTime: number;
    displayPrice: number;
    inLiveBidding: boolean;
    inPreBidding: boolean;
    showBidStatusEndDate: boolean;
    auctionStarts: number;
    bidUIDs: number[];
    bidUuids: string[];
    sold: boolean;
    preview: boolean;
    complete: boolean;
}
export interface TimedUserInfoModel {
    itemId: number;
    highestAutoBid: number;
    highestOfferAcceptedUID: number;
    highestOfferAcceptedAmount: number;
    offerModels: OfferModel[];
    maxNumberOfOffersMade: boolean;
    userUuid: string | null;
    highestAutoBidUuid: string | null;
    highestOfferUuid: string | null;
}
export interface LocaleSensitiveModel {
    currency: CurrencyModel;
    countryCode: string;
    countryName: string;
    title: string;
    auctionTitle: string;
    summary: string | null;
}
export interface ItemTypeModel {
    id: number | null;
    name: string | null;
    code: string | null;
    selected: boolean;
    uuid: string | null;
    webcasty: boolean;
    catalogue: boolean;
    type: string;
    auctionType: string;
    marketplace: boolean;
    bulkBuyItem: boolean;
    listingItem: boolean;
    lotItem: boolean;
    webcastItem: boolean;
    webcastGroupItem: boolean;
    supportsBidding: boolean;
}
export interface CategoryModel {
    id: number;
    name: string;
    code: string | null;
    selected: boolean;
    uuid: string;
    treeName: string;
    treeId: number;
    parentName: string;
    parentId: number;
    children: CategoryModel[] | null;
}
export interface UserRegistrationModel {
    userId: number;
    id: number;
    registrationId: number;
    auctionId: number;
    paddleNumber: number;
    statusName: string;
    status: number;
    statusLabel: string;
    registered: boolean;
    approved: boolean;
    depositPayableOnline: boolean;
    locationVerified: boolean;
    phoneVerified: boolean;
    registrantUuid: string;
    userUuid: string;
    county: string;
    city: string;
    countryCode: string;
}
//# sourceMappingURL=timed.types.d.ts.map
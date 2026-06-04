import { WebAppModel } from '../public/model/model.types';
export interface Country {
    countryCode: string;
    countryName: string;
}
export interface Address {
    address: string;
    locationLatitude: string;
    locationLongitude: string;
    timeZoneCode: string | null;
}
export interface ApiResponse<T> {
    message: T;
}
export interface ErrorModel {
    failed: boolean;
    field: string | null;
    code: string;
    message: string | null;
    loggedIn: boolean;
}
export interface UnauthorizedError {
    error: string;
    error_description: string;
}
export interface CurrencyModel {
    id: number;
    name: string | null;
    code: string;
    selected: boolean;
    uuid: string;
    symbol: string;
}
export interface TimeZoneModel {
    id: number;
    name: string;
    code: string;
    selected: boolean;
    uuid: string | null;
    zone: string | null;
}
export interface ClientOptionsModel {
    showWinningBidAmount: boolean;
    showNumberOfBids: boolean;
    showBidIncrements: boolean;
    showBidStatusEndDate: boolean;
    showAutobidOnly: boolean;
    hideRelatedItems: boolean;
    maxOffersPerItem: number;
}
export interface LanguageModel {
    id: number;
    name: string | null;
    code: string;
    selected: boolean;
    uuid: string | null;
}
export interface UserAddressModel {
    id: number;
    version: number;
    addressType: number;
    addressLine1: string;
    addressLine2: string | null;
    addressLine3: string | null;
    addressLine4: string | null;
    city: string;
    county: string;
    postcode: string;
    countryId: number;
    countryCode: string;
    countryName: string | null;
    continentId: number;
    continentCode: string | null;
    latitude: string;
    longitude: string;
}
export interface AttachmentModel {
    attachmentUrl: string;
    label: string;
    originalFilename: string;
    size: string;
    cloudinaryBasePath: string;
    cloudinaryVersionAndPublicId: string;
    previewSrc: string | null;
    thumbSrc: string | null;
    lightboxSrc: string | null;
    lotNumber: string | null;
    imageId: number;
    uuid: string;
}
export interface OfferModel {
    uuid: string;
    amount: number;
    rejected: boolean;
    listingUuid: string;
    userUuid: string;
}
export interface AuctioneerModel {
    webApp: WebAppModel;
    clientOptions: ClientOptionsModel;
    auctioneerId: number;
    name: string;
    cloudyLogo: AttachmentModel | null;
    logo: string;
    facebookApplicationId: string | null;
    auctionEventCount: number;
    auctionWebcastCount: number;
    email: string;
    website: string;
    contactNumber: string;
    description: string | null;
    liveAuctionIds: number[];
}
export interface UserModel {
    id: number | null;
    externalUserRef: string | null;
    language: LanguageModel;
    timeZone: TimeZoneModel;
    signupSource: string | null;
    securityQuestion: string | null;
    webAppId: number | null;
    statusId: number | null;
    uuid: string | null;
    redFlag: boolean;
    redFlagReason: string | null;
    whitelist: boolean;
    username: string;
    forename: string | null;
    surname: string | null;
    companyName: string | null;
    inserted: number;
    updated: number | null;
    activated: number | null;
    lastLoggedIn: number | null;
    penultimateLogin: number | null;
    protectedResources: string | null;
    localeFormat: string;
    localeInternal: string;
    thousandsSeparator: string;
    currencySymbolAsPrefix: boolean;
    loginAdminError: boolean;
    systemAdmin: boolean;
    adminLoggedIn: boolean;
    adminLoginPermitted: boolean;
    accountNonLocked: boolean;
    enabled: boolean;
    credentialsNonExpired: boolean;
    accountNonExpired: boolean;
    outbidEmailsOk: boolean;
    receiveEmailsOk: boolean;
    forcePasswordReset: boolean;
    publicVendorAdmin: boolean;
    mainAddress: UserAddressModel | null;
    shippingAddress: UserAddressModel | null;
    billingAddress: UserAddressModel | null;
    hasMainAddress: boolean;
    hasShippingAddress: boolean;
    hasBillingAddress: boolean;
    phoneVerified: boolean;
    verifiedPhoneNumber: string | null;
    auctioneerModels: AuctioneerModel[] | null;
    accessToken: string | null;
    loginFromBlade: boolean;
    loginFromBladeUrl: string | null;
    bladeClientLogo: string | null;
    displayName: string;
}
//# sourceMappingURL=common.d.ts.map
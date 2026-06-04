import { Country, CurrencyModel, LanguageModel, UserModel } from '../../types/common';
export interface AccountIconsModel {
    bidsLosingCount: number;
    unpaidInvoiceCount: number;
    unreadMessagesCount: number;
    pendingOffersCount: number;
}
export interface MetaModel {
    metaRefresh: boolean;
    metaTitle: string;
    metaDescription: string | null;
    openGraphData: string | null;
}
export interface StringsModel {
    i16Strings: Record<string, string>;
}
export interface LabelValueModel {
    label: string;
    value: number;
}
export interface PartnerWebAppModel {
    id: number;
    countryCode: string;
    countryName: string;
    contextPath: string;
    languageCode: string;
    url: string;
}
export interface WebAppOptionModel {
    contextPath: string | null;
    translationAllowed: boolean;
    autoTranslation: boolean;
    analyticsAllowed: boolean;
    analyticsPageTrackId: string;
    analyticsProfileId: string;
    analyticsFilterCreated: boolean;
    demandbaseKey: string;
    googleTagManagerEnabled: boolean;
    googleTagManagerContainerId: string | null;
    marketingSwitchedOn: boolean;
    itemAlertsEnabled: boolean;
    defaultGotoLotByTitle: boolean;
    hideFineGrainedEmailPrefs: boolean;
    outbidEmailsDefaultedToTrue: boolean;
    receiveEmailsForUpcomingSalesDefaultedToTrue: boolean;
    adminOnlyAccountActivation: boolean;
    breakdownCategoryFilterToSubCategory: boolean;
    maxItemsForLayout: number;
    uiShowItemRoundels: boolean;
    uiShowItemFlags: boolean;
    uiShowAuctionLogosOnLandingPages: boolean;
    cardVerificationSwitchedOn: boolean;
    requestVatNumber: boolean;
    allowContactSellerOnAllPages: boolean;
    allowOffersOnAllPages: boolean;
    recentlyAddedMaxAge: number;
    defaultAuctioneerId: number;
    signUpSourceMandatory: boolean;
    showNewsFromPartners: boolean;
    itemImageTransformOperation: string | null;
    auctionImageTransformOperation: string | null;
    defaultExternalClientRefPrefix: string;
    useGalleryLayoutForBidding: boolean;
    useGalleryLayoutForCalendar: boolean;
    supportsServiceProviders: boolean;
    showSaleInfoInPage: boolean;
    splitInvoicesByVendor: boolean;
}
export interface WebAppLoginModel {
    bidlogixLogin: boolean;
    geLogin: boolean;
    facebookLogin: boolean;
    chainAmsLogin: boolean;
    chameleonLogin: boolean;
    logoutCallbackUrl: string | null;
    externalBaseUrl: string | null;
    dataPushUrl: string;
}
export interface WebAppModel {
    id: number;
    homepageLayoutId: number;
    auctioneerCentric: boolean;
    partners: PartnerWebAppModel[];
    partnersTwoWay: PartnerWebAppModel[];
    categoryTrees: LabelValueModel[];
    supportedLanguages: LanguageModel[] | null;
    allowedWebApps: Record<string, string> | null;
    supportsServiceProviders: boolean;
    showSaleInfoInPage: boolean;
    showItemAlerts: boolean;
    defaultGotoLotByTitle: boolean;
    supportsLanguageSwitch: boolean;
    multiTreeAuctioneer: boolean;
    blankslateEnabled: boolean;
    languageCode: string;
    analyticsPageTrackId: string;
    analyticsAllowed: boolean;
    googleTagManagerEnabled: boolean;
    googleTagManagerContainerId: string | null;
    demandbaseKey: string;
    supportsInvoicing: boolean;
    contactCountryName: string;
    contactCountryCode: string;
    contactEmail: string;
    contactTelephone: string;
    blogUrl: string;
    continentIds: string;
    timezoneId: number;
    cardVerificationSwitchedOn: boolean;
    hideFineGrainedEmailPrefs: boolean;
    requestVatNumber: boolean;
    accountActivationViaAdminOnly: boolean;
    receiveEmailsForUpcomingSalesDefaultedToTrue: boolean;
    outbidEmailsDefaultedToTrue: boolean;
    signUpSourceMandatory: boolean;
    showNewsFromPartners: boolean;
    phoneVerificationSwitchedOn: boolean;
    showAuctionLogosOnLandingPages: boolean;
    defaultExternalClientRefPrefix: string;
    useGalleryLayoutForBidding: boolean;
    useGalleryLayoutForCalendar: boolean;
    options: WebAppOptionModel;
    webAppLogin: WebAppLoginModel;
    bladeClientLogo: string;
    name: string;
    hideFindBySearch: boolean;
}
export interface RabbitResponseCode {
    id: number;
    secure: boolean;
    quickResponse: boolean;
    name: string;
}
export interface MyBidsSearchType {
    id: number;
    name: string;
    primary: boolean;
    pageable: boolean;
}
export interface StatusModel {
    bidStatuses: Record<string, string>;
    biddingTypesById: Record<string, string>;
    biddingTypesByName: Record<string, number>;
    choicesById: Record<string, string>;
    choicesByName: Record<string, number>;
    messageTypeEnumMappings: Record<string, number>;
    messageDisplayEnumMappings: Record<string, number>;
    messageTargetEnumMappings: Record<string, number>;
    webcastStatesById: Record<string, string>;
    webcastStatesByName: Record<string, number>;
    onceTwiceStatusesByName: Record<string, number>;
    feedProvidersByName: Record<string, string>;
    feedTypesByName: Record<string, string>;
    userBiddingStatuses: Record<string, number>;
    rabbitResponseCodes: RabbitResponseCode[];
    myBidsSearchTypes: MyBidsSearchType[];
    responseCodes: Record<string, number>;
    currencies: CurrencyModel[];
}
export interface ContentModel {
    content: string;
}
export interface ServerConfigBladeModel {
    uid: string;
    serverTimestamp: number;
    itemImageTransformOperation: string | null;
    auctionImageTransformOperation: string | null;
    itemsPageSize: number;
}
export interface CoreBladeModel {
    keyMap: Record<string, string>;
    userModel: UserModel;
    accountIconsModel: AccountIconsModel | null;
    metaModel: MetaModel;
    stringsModel: StringsModel;
    webAppModel: WebAppModel;
    statusModel: StatusModel;
    fourOFour: ContentModel;
    serverConfigModel: ServerConfigBladeModel;
    countries: Country[];
}
//# sourceMappingURL=model.types.d.ts.map
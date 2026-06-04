import { TimeZoneModel, AttachmentModel, AuctioneerModel } from '../../types/common';
export interface HomeResponse {
    worked: boolean;
    itemId: number | null;
    actionCode: number;
    uid: number | null;
    userId: number | null;
    models: HomeResponseModels;
}
export interface HomeResponseModels {
    HomePageModel: HomePageModel;
}
export interface HomePageModel {
    sliderModel: SliderModel;
    upcomingModel: UpcomingModel;
    layoutId: string;
    supportsSlider: boolean;
}
export interface SliderModel {
    id: number | null;
    version: number;
    created: number | null;
    updated: number | null;
    uuid: string | null;
    selected: boolean;
    markedForDeletion: boolean;
    width: number;
    height: number;
    sliderEnabled: boolean;
    autoStart: boolean;
    responsive: boolean;
    responsiveUnder: number;
    sublayerContainer: number;
    firstLayer: number;
    twoWaySlideshow: boolean;
    randomSlideshow: boolean;
    keybNav: boolean;
    touchNav: boolean;
    imgPreload: boolean;
    navPrevNext: boolean;
    navStartStop: boolean;
    navButtons: boolean;
    thumbnailNavigation: string;
    tnWidth: number;
    tnHeight: number;
    tnContainerWidth: string;
    tnActiveOpacity: number;
    tnInactiveOpacity: number;
    hoverPrevNext: boolean;
    hoverBottomNav: boolean;
    skin: string;
    pauseOnHover: boolean;
    globalBGColor: string;
    globalBGImage: boolean;
    animateFirstLayer: boolean;
    yourLogo: boolean;
    yourLogoStyle: string;
    yourLogoLink: boolean;
    yourLogoTarget: string;
    loops: number;
    forceLoopNum: boolean;
    autoPlayVideos: boolean;
    autoPauseSlideshow: string;
    youtubePreview: string;
    showBarTimer: boolean;
    showCircleTimer: boolean;
    slideDirection: string;
    slideDelay: number;
    durationIn: number;
    durationOut: number;
    easingIn: string;
    easingOut: string;
    delayIn: number;
    delayOut: number;
    webAppId: number;
    attachmentPath: string;
    idSet: boolean;
    idNotSet: boolean;
    empty: boolean;
    notEmpty: boolean;
    isEmpty: boolean;
}
export interface UpcomingModel {
    primaryDateToday: boolean;
    countEvent: number;
    countWebcast: number;
    countFeaturedEvent: number;
    countFeaturedWebcast: number;
    countMarketplaceItems: number;
    upcomingAuctions: UpcomingAuctionModel[];
    liveAuctioneers: AuctioneerModel[];
    countries: string[];
    registeredFor: Record<string, string>;
}
export interface UpcomingAuctionModel {
    auctionId: number;
    auctionUuid: string;
    title: string;
    description: string | null;
    auctioneerName: string;
    endsOrStarts: string;
    timeRemaining: string | null;
    timedType: boolean;
    catalogue: boolean;
    webcastType: boolean;
    marketType: boolean;
    typeMessage: string;
    location: string;
    containsFeaturedItems: boolean;
    numberOfItems: number;
    auctionLogo: string | null;
    auctioneerLogo: string | null;
    upcomingItems: UpcomingItemModel[];
    itemCount: number;
    endsToday: boolean;
    firstItem: UpcomingItemModel;
    endOrStartTimestamp: number;
    locale: string;
    timeZone: TimeZoneModel;
    auctionStartTime: number;
    auctionStartTimeString: string | null;
}
export interface UpcomingItemModel {
    itemId: number;
    auctionId: number;
    title: string;
    attachmentModel: AttachmentModel | null;
}
//# sourceMappingURL=home.types.d.ts.map
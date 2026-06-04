"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const home_1 = require("./home");
const http_client_1 = require("../../http/http-client");
const errors_1 = require("../../http/errors");
const mockFetch = jest.fn();
global.fetch = mockFetch;
const httpClient = new http_client_1.HttpClient({
    baseUrl: 'https://example.com',
    headers: { 'x-forwarded-client-id': 'auction', 'accept-language': 'en-GB' }
});
const resource = new home_1.HomeResource(httpClient);
beforeEach(() => {
    mockFetch.mockReset();
});
const homeResponseFixture = {
    worked: true,
    itemId: null,
    actionCode: 118,
    uid: null,
    userId: null,
    models: {
        HomePageModel: {
            sliderModel: {
                id: null,
                version: 0,
                created: null,
                updated: null,
                uuid: null,
                selected: false,
                markedForDeletion: false,
                width: 800,
                height: 300,
                sliderEnabled: false,
                autoStart: true,
                responsive: false,
                responsiveUnder: 0,
                sublayerContainer: 0,
                firstLayer: 1,
                twoWaySlideshow: false,
                randomSlideshow: false,
                keybNav: true,
                touchNav: true,
                imgPreload: true,
                navPrevNext: true,
                navStartStop: true,
                navButtons: true,
                thumbnailNavigation: 'hover',
                tnWidth: 100,
                tnHeight: 60,
                tnContainerWidth: '60%',
                tnActiveOpacity: 35,
                tnInactiveOpacity: 100,
                hoverPrevNext: true,
                hoverBottomNav: false,
                skin: 'defaultskin',
                pauseOnHover: true,
                globalBGColor: 'transparent',
                globalBGImage: false,
                animateFirstLayer: false,
                yourLogo: false,
                yourLogoStyle: 'position: absolute; z-index: 1001; left: 10px; top: 10px;',
                yourLogoLink: false,
                yourLogoTarget: '_blank',
                loops: 0,
                forceLoopNum: true,
                autoPlayVideos: false,
                autoPauseSlideshow: 'auto',
                youtubePreview: 'maxresdefault.jpg',
                showBarTimer: false,
                showCircleTimer: false,
                slideDirection: 'right',
                slideDelay: 2000,
                durationIn: 3000,
                durationOut: 3000,
                easingIn: 'easeInOutQuint',
                easingOut: 'easeInOutQuint',
                delayIn: 0,
                delayOut: 0,
                webAppId: 1,
                attachmentPath: 'static/resources/HomepageSlider_1',
                idSet: false,
                idNotSet: true,
                empty: false,
                notEmpty: true,
                isEmpty: false
            },
            upcomingModel: {
                primaryDateToday: false,
                countEvent: 6,
                countWebcast: 2,
                countFeaturedEvent: 0,
                countFeaturedWebcast: 0,
                countMarketplaceItems: 9,
                upcomingAuctions: [
                    {
                        auctionId: 149,
                        auctionUuid: 'fd81e166-6764-11ed-9022-0242ac120002',
                        title: 'Webcast Auction UK One',
                        description: 'A webcast auction by Apex UK',
                        auctioneerName: 'Apex UK',
                        endsOrStarts: 'Started',
                        timeRemaining: null,
                        timedType: false,
                        catalogue: false,
                        webcastType: true,
                        marketType: false,
                        typeMessage: 'Webcast Auction',
                        location: 'United Kingdom',
                        containsFeaturedItems: false,
                        numberOfItems: 0,
                        auctionLogo: null,
                        auctioneerLogo: null,
                        upcomingItems: [
                            {
                                itemId: 208,
                                auctionId: 149,
                                title: 'Item 3 Quantity 12 Per Item',
                                attachmentModel: {
                                    attachmentUrl: 'https://res.cloudinary.com/bidlogix-staging/image/upload/v1/local_test_data/a.jpg',
                                    label: 'a.jpg',
                                    originalFilename: 'a.jpg',
                                    size: '68',
                                    cloudinaryBasePath: 'https://res.cloudinary.com/bidlogix-staging/image/upload/',
                                    cloudinaryVersionAndPublicId: 'v1/local_test_data/a.jpg',
                                    previewSrc: null,
                                    thumbSrc: null,
                                    lightboxSrc: null,
                                    lotNumber: '12',
                                    imageId: 1547,
                                    uuid: 'd14aa7dc-07f2-11f1-9aef-2a57eaf1d4af'
                                }
                            }
                        ],
                        itemCount: 6,
                        endsToday: false,
                        firstItem: {
                            itemId: 208,
                            auctionId: 149,
                            title: 'Item 3 Quantity 12 Per Item',
                            attachmentModel: {
                                attachmentUrl: 'https://res.cloudinary.com/bidlogix-staging/image/upload/v1/local_test_data/a.jpg',
                                label: 'a.jpg',
                                originalFilename: 'a.jpg',
                                size: '68',
                                cloudinaryBasePath: 'https://res.cloudinary.com/bidlogix-staging/image/upload/',
                                cloudinaryVersionAndPublicId: 'v1/local_test_data/a.jpg',
                                previewSrc: null,
                                thumbSrc: null,
                                lightboxSrc: null,
                                lotNumber: '12',
                                imageId: 1547,
                                uuid: 'd14aa7dc-07f2-11f1-9aef-2a57eaf1d4af'
                            }
                        },
                        endOrStartTimestamp: 1770813000000,
                        locale: 'en_GB',
                        timeZone: {
                            id: 3,
                            name: '(GMT) Europe/London (GMT)',
                            code: 'Europe/London',
                            selected: false,
                            uuid: 'd2d63b55-07f2-11f1-9aef-2a57eaf1d4af',
                            zone: null
                        },
                        auctionStartTime: 1770813000000,
                        auctionStartTimeString: null
                    }
                ],
                liveAuctioneers: [
                    {
                        webApp: {
                            id: 1,
                            homepageLayoutId: 1,
                            auctioneerCentric: false,
                            partners: [],
                            partnersTwoWay: [],
                            categoryTrees: [],
                            supportedLanguages: [],
                            allowedWebApps: null,
                            supportsServiceProviders: true,
                            showSaleInfoInPage: true,
                            showItemAlerts: false,
                            defaultGotoLotByTitle: false,
                            supportsLanguageSwitch: true,
                            multiTreeAuctioneer: true,
                            blankslateEnabled: false,
                            languageCode: 'en',
                            analyticsPageTrackId: 'UA-641770-1',
                            analyticsAllowed: false,
                            googleTagManagerEnabled: false,
                            googleTagManagerContainerId: null,
                            demandbaseKey: '',
                            supportsInvoicing: true,
                            contactCountryName: 'United Kingdom',
                            contactCountryCode: 'uk',
                            contactEmail: 'info@apexauctions.com',
                            contactTelephone: '+44 (0) 1273 224466',
                            blogUrl: 'http://blog.apexauctions.com',
                            continentIds: '1',
                            timezoneId: 3,
                            cardVerificationSwitchedOn: false,
                            hideFineGrainedEmailPrefs: false,
                            requestVatNumber: false,
                            accountActivationViaAdminOnly: false,
                            receiveEmailsForUpcomingSalesDefaultedToTrue: false,
                            outbidEmailsDefaultedToTrue: false,
                            signUpSourceMandatory: false,
                            showNewsFromPartners: true,
                            phoneVerificationSwitchedOn: false,
                            showAuctionLogosOnLandingPages: false,
                            defaultExternalClientRefPrefix: '',
                            useGalleryLayoutForBidding: true,
                            useGalleryLayoutForCalendar: true,
                            options: {
                                contextPath: null,
                                translationAllowed: true,
                                autoTranslation: true,
                                analyticsAllowed: false,
                                analyticsPageTrackId: 'UA-641770-1',
                                analyticsProfileId: '194880086',
                                analyticsFilterCreated: false,
                                demandbaseKey: '',
                                googleTagManagerEnabled: false,
                                googleTagManagerContainerId: null,
                                marketingSwitchedOn: true,
                                itemAlertsEnabled: false,
                                defaultGotoLotByTitle: false,
                                hideFineGrainedEmailPrefs: false,
                                outbidEmailsDefaultedToTrue: false,
                                receiveEmailsForUpcomingSalesDefaultedToTrue: false,
                                adminOnlyAccountActivation: false,
                                breakdownCategoryFilterToSubCategory: false,
                                maxItemsForLayout: 1,
                                uiShowItemRoundels: true,
                                uiShowItemFlags: true,
                                uiShowAuctionLogosOnLandingPages: false,
                                cardVerificationSwitchedOn: false,
                                requestVatNumber: false,
                                allowContactSellerOnAllPages: false,
                                allowOffersOnAllPages: false,
                                recentlyAddedMaxAge: 1,
                                defaultAuctioneerId: 0,
                                signUpSourceMandatory: false,
                                showNewsFromPartners: true,
                                itemImageTransformOperation: null,
                                auctionImageTransformOperation: null,
                                defaultExternalClientRefPrefix: '',
                                useGalleryLayoutForBidding: true,
                                useGalleryLayoutForCalendar: true,
                                supportsServiceProviders: true,
                                showSaleInfoInPage: true,
                                splitInvoicesByVendor: true
                            },
                            webAppLogin: {
                                bidlogixLogin: true,
                                geLogin: false,
                                facebookLogin: false,
                                chainAmsLogin: false,
                                chameleonLogin: false,
                                logoutCallbackUrl: null,
                                externalBaseUrl: null,
                                dataPushUrl: 'http://localhost/ms-chameleon/auction'
                            },
                            bladeClientLogo: 'logo.png',
                            name: 'Europe Auction House',
                            hideFindBySearch: false
                        },
                        clientOptions: {
                            showWinningBidAmount: false,
                            showNumberOfBids: false,
                            showBidIncrements: true,
                            showBidStatusEndDate: true,
                            showAutobidOnly: false,
                            hideRelatedItems: false,
                            maxOffersPerItem: 3
                        },
                        auctioneerId: 1,
                        name: 'Apex UK',
                        cloudyLogo: null,
                        logo: '',
                        facebookApplicationId: null,
                        auctionEventCount: 0,
                        auctionWebcastCount: 1,
                        email: 'info@apexauctions.com',
                        website: '',
                        contactNumber: '+44 (0) 1273 224466',
                        description: null,
                        liveAuctionIds: []
                    }
                ],
                countries: ['United States', 'United Kingdom'],
                registeredFor: {}
            },
            layoutId: 'DATE_ORDERED',
            supportsSlider: false
        }
    }
};
const rawApiResponse = {
    '@class': '.TimedResponse',
    ...homeResponseFixture,
    models: {
        HomePageModel: {
            '@class': 'com.bidlogix.scaffold.models.upcoming.HomePageModel',
            ...homeResponseFixture.models.HomePageModel,
            upcomingModel: {
                '@class': '.UpcomingModel',
                ...homeResponseFixture.models.HomePageModel.upcomingModel,
                upcomingAuctions: [
                    {
                        '@class': '.UpcomingAuctionModel',
                        ...homeResponseFixture.models.HomePageModel.upcomingModel.upcomingAuctions[0],
                        upcomingItems: [
                            {
                                '@class': '.UpcomingItemModel',
                                ...homeResponseFixture.models.HomePageModel.upcomingModel.upcomingAuctions[0].upcomingItems[0],
                                attachmentModel: {
                                    '@class': '.AttachmentModel',
                                    ...homeResponseFixture.models.HomePageModel.upcomingModel.upcomingAuctions[0].upcomingItems[0].attachmentModel
                                }
                            }
                        ],
                        firstItem: {
                            '@class': '.UpcomingItemModel',
                            ...homeResponseFixture.models.HomePageModel.upcomingModel.upcomingAuctions[0].firstItem,
                            attachmentModel: {
                                '@class': '.AttachmentModel',
                                ...homeResponseFixture.models.HomePageModel.upcomingModel.upcomingAuctions[0].firstItem.attachmentModel
                            }
                        },
                        timeZone: {
                            '@class': '.TimeZoneModel',
                            ...homeResponseFixture.models.HomePageModel.upcomingModel.upcomingAuctions[0].timeZone
                        }
                    }
                ],
                liveAuctioneers: [
                    {
                        '@class': '.AuctioneerModel',
                        ...homeResponseFixture.models.HomePageModel.upcomingModel.liveAuctioneers[0],
                        webApp: {
                            '@class': '.WebAppModel',
                            ...homeResponseFixture.models.HomePageModel.upcomingModel.liveAuctioneers[0].webApp,
                            options: {
                                '@class': '.WebAppOptionModel',
                                ...homeResponseFixture.models.HomePageModel.upcomingModel.liveAuctioneers[0].webApp.options
                            },
                            webAppLogin: {
                                '@class': '.WebAppLoginModel',
                                ...homeResponseFixture.models.HomePageModel.upcomingModel.liveAuctioneers[0].webApp.webAppLogin
                            }
                        },
                        clientOptions: {
                            '@class': '.ClientOptionsModel',
                            ...homeResponseFixture.models.HomePageModel.upcomingModel.liveAuctioneers[0].clientOptions
                        }
                    }
                ]
            }
        }
    }
};
describe('HomeResource', () => {
    describe('v1.get', () => {
        it('should call the correct endpoint', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(rawApiResponse)
            });
            await resource.v1.get();
            expect(mockFetch).toHaveBeenCalledWith('https://example.com/auction-007/api/v1/home', expect.objectContaining({ method: 'GET' }));
        });
        it('should strip @class from response and all nested objects', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(rawApiResponse)
            });
            const result = await resource.v1.get();
            expect(result).not.toHaveProperty('@class');
            expect(result.models.HomePageModel).not.toHaveProperty('@class');
            expect(result.models.HomePageModel.upcomingModel).not.toHaveProperty('@class');
            expect(result.models.HomePageModel.upcomingModel.upcomingAuctions[0]).not.toHaveProperty('@class');
            expect(result.models.HomePageModel.upcomingModel.upcomingAuctions[0].upcomingItems[0]).not.toHaveProperty('@class');
            expect(result.models.HomePageModel.upcomingModel.upcomingAuctions[0].upcomingItems[0].attachmentModel).not.toHaveProperty('@class');
            expect(result.models.HomePageModel.upcomingModel.upcomingAuctions[0].firstItem).not.toHaveProperty('@class');
            expect(result.models.HomePageModel.upcomingModel.upcomingAuctions[0].timeZone).not.toHaveProperty('@class');
            expect(result.models.HomePageModel.upcomingModel.liveAuctioneers[0]).not.toHaveProperty('@class');
            expect(result.models.HomePageModel.upcomingModel.liveAuctioneers[0].webApp).not.toHaveProperty('@class');
            expect(result.models.HomePageModel.upcomingModel.liveAuctioneers[0].webApp.options).not.toHaveProperty('@class');
            expect(result.models.HomePageModel.upcomingModel.liveAuctioneers[0].webApp.webAppLogin).not.toHaveProperty('@class');
            expect(result.models.HomePageModel.upcomingModel.liveAuctioneers[0].clientOptions).not.toHaveProperty('@class');
        });
        it('should return home page data', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(rawApiResponse)
            });
            const result = await resource.v1.get();
            expect(result.worked).toBe(true);
            expect(result.actionCode).toBe(118);
            expect(result.models.HomePageModel.layoutId).toBe('DATE_ORDERED');
            expect(result.models.HomePageModel.supportsSlider).toBe(false);
        });
        it('should return slider model data', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(rawApiResponse)
            });
            const result = await resource.v1.get();
            const slider = result.models.HomePageModel.sliderModel;
            expect(slider.width).toBe(800);
            expect(slider.height).toBe(300);
            expect(slider.sliderEnabled).toBe(false);
            expect(slider.skin).toBe('defaultskin');
        });
        it('should return upcoming auctions data', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(rawApiResponse)
            });
            const result = await resource.v1.get();
            const upcoming = result.models.HomePageModel.upcomingModel;
            expect(upcoming.countEvent).toBe(6);
            expect(upcoming.countWebcast).toBe(2);
            expect(upcoming.countMarketplaceItems).toBe(9);
            expect(upcoming.upcomingAuctions).toHaveLength(1);
            expect(upcoming.upcomingAuctions[0].title).toBe('Webcast Auction UK One');
            expect(upcoming.upcomingAuctions[0].auctionUuid).toBe('fd81e166-6764-11ed-9022-0242ac120002');
            expect(upcoming.upcomingAuctions[0].webcastType).toBe(true);
            expect(upcoming.upcomingAuctions[0].timeZone.code).toBe('Europe/London');
            expect(upcoming.countries).toEqual(['United States', 'United Kingdom']);
        });
        it('should return upcoming items with attachments', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(rawApiResponse)
            });
            const result = await resource.v1.get();
            const item = result.models.HomePageModel.upcomingModel.upcomingAuctions[0].upcomingItems[0];
            expect(item.itemId).toBe(208);
            expect(item.title).toBe('Item 3 Quantity 12 Per Item');
            expect(item.attachmentModel).not.toBeNull();
            expect(item.attachmentModel.label).toBe('a.jpg');
            expect(item.attachmentModel.imageId).toBe(1547);
        });
        it('should return auctioneer data', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(rawApiResponse)
            });
            const result = await resource.v1.get();
            const auctioneer = result.models.HomePageModel.upcomingModel.liveAuctioneers[0];
            expect(auctioneer.auctioneerId).toBe(1);
            expect(auctioneer.name).toBe('Apex UK');
            expect(auctioneer.email).toBe('info@apexauctions.com');
            expect(auctioneer.webApp.name).toBe('Europe Auction House');
            expect(auctioneer.clientOptions.showBidIncrements).toBe(true);
        });
        it('should throw BidJSHttpError on error response', async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 500,
                text: () => Promise.resolve(JSON.stringify({
                    '@class': '.ErrorModel',
                    failed: true,
                    field: null,
                    code: '500',
                    message: null,
                    loggedIn: false
                }))
            });
            await expect(resource.v1.get()).rejects.toThrow(errors_1.BidJSHttpError);
        });
    });
});
//# sourceMappingURL=home.test.js.map
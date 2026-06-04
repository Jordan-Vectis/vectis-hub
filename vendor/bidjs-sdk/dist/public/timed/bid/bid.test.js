"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bid_1 = require("./bid");
const http_client_1 = require("../../../http/http-client");
const errors_1 = require("../../../http/errors");
const mockFetch = jest.fn();
global.fetch = mockFetch;
const httpClient = new http_client_1.HttpClient({
    baseUrl: 'https://example.com',
    headers: { 'x-forwarded-client-id': 'auction', 'accept-language': 'en-GB' }
});
httpClient.setAccessToken('test-jwt-token');
const resource = new bid_1.BidResource(httpClient);
beforeEach(() => {
    mockFetch.mockReset();
});
const timedResponseFixture = {
    worked: true,
    itemId: 1016186,
    actionCode: 100,
    uid: null,
    userId: null,
    models: {
        BiddingItemModel: {
            id: 1016186,
            listingUuid: '07f95fe3-7544-47f8-93b1-752ce9d322b9',
            timedBiddingInfo: {
                itemId: 0,
                ofBulkBuyType: false,
                version: 3,
                statusId: 4,
                publicVisible: true,
                highestBid: 200,
                highestBidUuid: null,
                highestOfferUuid: null,
                increment: 50,
                openingBid: 100,
                numberOfBids: 3,
                reserve: 300,
                reserveReached: true,
                overtimeBidding: false,
                buyNowEnabled: false,
                makeOfferEnabled: false,
                transferEnabled: false,
                tenderEnabled: false,
                tenderPctEnabled: false,
                purchaseCutoff: 2,
                contactSellerEnabled: false,
                minimumOfferOrBuyNowPrice: 0,
                unitOfMeasurement: null,
                highestBidUID: 238745,
                highestBidPlacedAt: null,
                highestBidHasAutobid: false,
                highestBidReserve: false,
                offerAccepted: false,
                purchaseOption: null,
                numberOfUnits: 22.00,
                itemCount: 1,
                numberOfUnitsRemaining: 0,
                biddingType: 3,
                biddingTypePerLot: false,
                biddingTypePerUnit: false,
                endTime: 1771020000000,
                actualEndTime: 0,
                displayPrice: 0,
                inLiveBidding: false,
                inPreBidding: false,
                showBidStatusEndDate: true,
                auctionStarts: 0,
                bidUIDs: [238745],
                bidUuids: [
                    'fd43f715-2b8b-4dd3-8f3f-b19981e334eb',
                    '75468ab6-83c7-4e85-9a91-50f8e228ac42',
                    'c1fd9cd2-d77a-469c-b472-aed59373f131'
                ],
                sold: false,
                preview: false,
                complete: false
            },
            timedUserInfo: null,
            localeSensitive: {
                currency: {
                    id: 2,
                    name: null,
                    code: 'GBP',
                    selected: false,
                    uuid: 'c1031887-9d63-11ee-9c28-06b878032aa0',
                    symbol: '&#163;'
                },
                countryCode: 'uk',
                countryName: 'United Kingdom',
                title: 'LOT NONE 1',
                auctionTitle: 'bidjs-sdk-testing',
                summary: null
            },
            buyersPremium: 0.00,
            itemType: {
                id: null,
                name: null,
                code: null,
                selected: false,
                uuid: null,
                webcasty: false,
                catalogue: false,
                type: 'Lot',
                auctionType: 'EventAuction',
                marketplace: false,
                bulkBuyItem: false,
                listingItem: false,
                lotItem: true,
                webcastItem: false,
                webcastGroupItem: false,
                supportsBidding: true
            },
            watchers: null,
            clientOptions: {
                showWinningBidAmount: false,
                showNumberOfBids: false,
                showBidIncrements: true,
                showBidStatusEndDate: true,
                showAutobidOnly: false,
                hideRelatedItems: true,
                maxOffersPerItem: 3
            },
            category: {
                id: 702,
                name: 'Scrapers',
                code: null,
                selected: false,
                uuid: '02c15a88-9353-11ea-a6c8-06ef874d2a1c',
                treeName: 'Construction',
                treeId: 8,
                parentName: 'Construction Plant and Equipment',
                parentId: 110,
                children: null
            },
            inPreBidding: false,
            preBiddingEnabled: true,
            dateAuctionStarts: 1770854400,
            lotNumber: '23',
            localeInternal: 'en',
            auctionId: 8057,
            registrant: null,
            recentlyAdded: false,
            watching: true,
            archived: false,
            showFlags: true,
            uiShowItemRoundels: true,
            showBiddingButton: true,
            firstImage: null,
            fullExternalWebpageUrl: null,
            timeZone: {
                id: 3,
                name: '(GMT) (GMT) UTC',
                code: 'Europe/London',
                selected: false,
                uuid: null,
                zone: null
            },
            itemDetailsAvailable: true,
            auctionUuid: 'c1e39006-eb40-4228-bc1d-2d0ab4d4adc4'
        },
        TimedUserInfoModel: {
            itemId: 1016186,
            highestAutoBid: 0,
            highestOfferAcceptedUID: 0,
            highestOfferAcceptedAmount: 0,
            offerModels: [],
            maxNumberOfOffersMade: false,
            userUuid: 'd549d023-419d-415d-b96e-3f766a94c054',
            highestAutoBidUuid: null,
            highestOfferUuid: null
        }
    }
};
const rawApiResponse = {
    '@class': '.TimedResponse',
    ...timedResponseFixture,
    models: {
        BiddingItemModel: {
            '@class': 'com.bidlogix.scaffold.models.bidding.BiddingItemModel',
            ...timedResponseFixture.models.BiddingItemModel,
            timedBiddingInfo: {
                '@class': '.TimedBiddingInfoModel',
                ...timedResponseFixture.models.BiddingItemModel.timedBiddingInfo
            },
            localeSensitive: {
                '@class': '.LocaleSensitiveModel',
                ...timedResponseFixture.models.BiddingItemModel.localeSensitive,
                currency: {
                    '@class': '.CurrencyModel',
                    ...timedResponseFixture.models.BiddingItemModel.localeSensitive.currency
                }
            },
            itemType: {
                '@class': '.ItemTypeModel',
                ...timedResponseFixture.models.BiddingItemModel.itemType
            },
            clientOptions: {
                '@class': '.ClientOptionsModel',
                ...timedResponseFixture.models.BiddingItemModel.clientOptions
            },
            category: {
                '@class': '.CategoryModel',
                ...timedResponseFixture.models.BiddingItemModel.category
            },
            timeZone: {
                '@class': '.TimeZoneModel',
                ...timedResponseFixture.models.BiddingItemModel.timeZone
            }
        },
        TimedUserInfoModel: {
            '@class': 'com.bidlogix.scaffold.models.bidding.TimedUserInfoModel',
            ...timedResponseFixture.models.TimedUserInfoModel
        }
    }
};
describe('BidResource', () => {
    describe('v1.post', () => {
        it('should call the correct endpoint with path segments', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(rawApiResponse)
            });
            await resource.v1.post(1016186, 500, 238745, 200);
            expect(mockFetch).toHaveBeenCalledWith('https://example.com/auction-007/api/v1/timed/bid/1016186/500/238745/200', expect.objectContaining({ method: 'POST' }));
        });
        it('should send an empty JSON body', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(rawApiResponse)
            });
            await resource.v1.post(1016186, 500, 238745, 200);
            expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
                body: JSON.stringify({})
            }));
        });
        it('should include authorization header in request', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(rawApiResponse)
            });
            await resource.v1.post(1016186, 500, 238745, 200);
            expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
                headers: expect.objectContaining({
                    'authorization': 'Bearer test-jwt-token'
                })
            }));
        });
        it('should strip @class from response and all nested objects', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(rawApiResponse)
            });
            const result = await resource.v1.post(1016186, 500, 238745, 200);
            expect(result).not.toHaveProperty('@class');
            expect(result.models.BiddingItemModel).not.toHaveProperty('@class');
            expect(result.models.BiddingItemModel.timedBiddingInfo).not.toHaveProperty('@class');
            expect(result.models.BiddingItemModel.localeSensitive).not.toHaveProperty('@class');
            expect(result.models.BiddingItemModel.localeSensitive.currency).not.toHaveProperty('@class');
            expect(result.models.BiddingItemModel.itemType).not.toHaveProperty('@class');
            expect(result.models.BiddingItemModel.clientOptions).not.toHaveProperty('@class');
            expect(result.models.BiddingItemModel.category).not.toHaveProperty('@class');
            expect(result.models.BiddingItemModel.timeZone).not.toHaveProperty('@class');
            expect(result.models.TimedUserInfoModel).not.toHaveProperty('@class');
        });
        it('should return timed response data', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(rawApiResponse)
            });
            const result = await resource.v1.post(1016186, 500, 238745, 200);
            expect(result.worked).toBe(true);
            expect(result.itemId).toBe(1016186);
            expect(result.actionCode).toBe(100);
            expect(result.models.BiddingItemModel.id).toBe(1016186);
            expect(result.models.BiddingItemModel.timedBiddingInfo.highestBid).toBe(200);
            expect(result.models.BiddingItemModel.timedBiddingInfo.numberOfBids).toBe(3);
            expect(result.models.BiddingItemModel.localeSensitive.currency.code).toBe('GBP');
            expect(result.models.BiddingItemModel.auctionUuid).toBe('c1e39006-eb40-4228-bc1d-2d0ab4d4adc4');
            expect(result.models.TimedUserInfoModel.itemId).toBe(1016186);
        });
        it('should strip password from watchers in BiddingItemModel', async () => {
            const responseWithWatchers = {
                ...rawApiResponse,
                models: {
                    ...rawApiResponse.models,
                    BiddingItemModel: {
                        ...rawApiResponse.models.BiddingItemModel,
                        watchers: [
                            { username: 'watcher@example.com', password: '$2a$10$hashedpassword', id: 1 }
                        ]
                    }
                }
            };
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(responseWithWatchers)
            });
            const result = await resource.v1.post(1016186, 500, 238745, 200);
            expect(result.models.BiddingItemModel.watchers[0]).not.toHaveProperty('password');
            expect(result.models.BiddingItemModel.watchers[0].username).toBe('watcher@example.com');
        });
        it('should throw BidJSHttpError on authentication failure', async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 401,
                text: () => Promise.resolve(JSON.stringify({
                    error: 'unauthorized',
                    error_description: 'unknown_code_ExceptionTranslationFilter'
                }))
            });
            await expect(resource.v1.post(1016186, 500, 238745, 200)).rejects.toThrow(errors_1.BidJSHttpError);
        });
        it('should throw BidJSHttpError on server error', async () => {
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
            await expect(resource.v1.post(1016186, 500, 238745, 200)).rejects.toThrow(errors_1.BidJSHttpError);
        });
    });
});
//# sourceMappingURL=bid.test.js.map
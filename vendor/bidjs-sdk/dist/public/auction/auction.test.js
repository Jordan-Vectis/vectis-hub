"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const auction_1 = require("./auction");
const http_client_1 = require("../../http/http-client");
const mockFetch = jest.fn();
global.fetch = mockFetch;
const httpClient = new http_client_1.HttpClient({
    baseUrl: 'https://example.com',
    headers: { 'x-forwarded-client-id': 'auction' }
});
const resource = new auction_1.AuctionResource(httpClient);
beforeEach(() => {
    mockFetch.mockReset();
});
const timedFixture = {
    information: {
        auction: {
            uuid: 'a028ee31-1c02-43ae-b410-170c638719d1',
            logoUuid: null,
            activeListings: ['listing-1'],
            id: 10541,
            live: false,
            webcast: false,
            title: 'Car Auction',
            endsAt: 1772236800000,
            startsAt: 1764085500000,
            status: 'LIVE'
        },
        listings: {
            'listing-1': {
                uuid: 'listing-1',
                id: 1,
                auctionIndex: 0,
                title: 'Car 1',
                description: '<p>Description</p>',
                summary: 'Summary',
                lotNumber: '1',
                images: [],
                documents: [],
                videos: [],
                categoryUuid: 'cat-1',
                type: 'lot',
                countryCode: 'UK',
                contactSeller: false,
                auctionUuid: 'a028ee31-1c02-43ae-b410-170c638719d1',
                buyersPremium: 20,
                charges: 0,
                buyersPremiumTaxRate: 20,
                chargesTaxRate: 20,
                hammerTaxRate: 20,
                address: {
                    address: 'United Kingdom',
                    locationLatitude: '',
                    locationLongitude: '',
                    timeZoneCode: null
                },
                marketplace: false,
                grouped: false,
                groupedItems: [],
                choiceId: null,
                minimumChoice: null
            }
        },
        categories: { children: {}, parents: {}, trees: {} },
        registrants: {},
        saleInformation: {
            description: 'Test',
            collectionInformation: '',
            contactInformation: '',
            removalInformation: '',
            paymentInformation: '',
            termsAndConditionsInformation: '',
            documents: [],
            currencyCode: 'GBP',
            buyersPremiumPercentage: 20,
            buyersPremiumTaxRate: 20,
            hammerTaxRate: 20,
            chargesTaxRate: 20,
            viewingDates: false,
            viewingStartDateTime: null,
            viewingEndDateTime: null,
            appointmentRequiredForViewing: false,
            viewingInstruction: '',
            clearanceDates: false,
            clearanceStartDateTime: null,
            clearanceEndDateTime: null,
            clearanceInstructions: '',
            address: 'UK',
            locationLatitude: '',
            locationLongitude: '',
            timeZoneCode: 'Europe/London',
            catalogueUrl: null,
            preBidding: false,
            salesTaxRequired: true
        },
        configuration: {
            hideRelatedItems: true,
            showWinningBid: true,
            showNumberOfBids: true,
            showBiddingEndDate: true,
            showAutoBidOnly: false,
            maximumOffersPerItem: 7,
            showSaleInfoPage: true,
            showItemLocation: false,
            itemLimitPerPage: 30,
            buyNowCutoff: 2,
            showBidIncrements: true
        },
        starredItems: []
    },
    sellingInformation: {
        bids: {},
        offers: {},
        sales: {},
        saleStatuses: {},
        maxBids: {},
        purchaseTypes: { '1': 'None' }
    },
    attachments: {},
    webcastInformation: null
};
const webcastFixture = {
    ...timedFixture,
    information: {
        ...timedFixture.information,
        auction: {
            ...timedFixture.information.auction,
            webcast: true,
            endsAt: null
        }
    },
    webcastInformation: {
        feed: {
            auctionUuid: 'a028ee31-1c02-43ae-b410-170c638719d1',
            sessionId: null
        },
        inPlay: {
            auctionUuid: 'a028ee31-1c02-43ae-b410-170c638719d1',
            listingUuid: 'listing-1',
            warningCount: 0,
            paused: false
        },
        messages: []
    }
};
const rawWebcastApiResponse = {
    ...webcastFixture,
    webcastInformation: {
        ...webcastFixture.webcastInformation,
        feed: {
            auctionUuid: 'a028ee31-1c02-43ae-b410-170c638719d1',
            apiKey: '12345',
            sessionId: null,
            token: 'tok_abc123'
        }
    }
};
describe('AuctionResource', () => {
    it('should call the correct endpoint with encoded UUID', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(timedFixture)
        });
        await resource.v3.get('a028ee31-1c02-43ae-b410-170c638719d1');
        expect(mockFetch).toHaveBeenCalledWith('https://example.com/auction-007/api/v3/auctions/a028ee31-1c02-43ae-b410-170c638719d1', expect.objectContaining({ method: 'GET' }));
    });
    it('should return timed auction response', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(timedFixture)
        });
        const result = await resource.v3.get('a028ee31-1c02-43ae-b410-170c638719d1');
        expect(result.webcastInformation).toBeNull();
        expect(result.information.auction.webcast).toBe(false);
        expect(result.information.auction.title).toBe('Car Auction');
    });
    it('should return webcast auction response', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(webcastFixture)
        });
        const result = await resource.v3.get('a028ee31-1c02-43ae-b410-170c638719d1');
        expect(result.webcastInformation).not.toBeNull();
        expect(result.information.auction.webcast).toBe(true);
        expect(result.webcastInformation.feed.sessionId).toBeNull();
    });
    it('should strip apiKey and token from webcastInformation.feed', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(rawWebcastApiResponse)
        });
        const result = await resource.v3.get('a028ee31-1c02-43ae-b410-170c638719d1');
        expect(result.webcastInformation.feed).not.toHaveProperty('apiKey');
        expect(result.webcastInformation.feed).not.toHaveProperty('token');
        expect(result.webcastInformation.feed.auctionUuid).toBe('a028ee31-1c02-43ae-b410-170c638719d1');
        expect(result.webcastInformation.feed.sessionId).toBeNull();
    });
    it('should encode special characters in UUID', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(timedFixture)
        });
        await resource.v3.get('test/uuid');
        expect(mockFetch).toHaveBeenCalledWith('https://example.com/auction-007/api/v3/auctions/test%2Fuuid', expect.anything());
    });
});
//# sourceMappingURL=auction.test.js.map
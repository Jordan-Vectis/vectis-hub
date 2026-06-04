"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const registerForAuction_1 = require("./registerForAuction");
const http_client_1 = require("../../http/http-client");
const errors_1 = require("../../http/errors");
const mockFetch = jest.fn();
global.fetch = mockFetch;
const httpClient = new http_client_1.HttpClient({
    baseUrl: 'https://example.com',
    headers: { 'x-forwarded-client-id': 'auction', 'accept-language': 'en-GB' }
});
httpClient.setAccessToken('test-jwt-token');
const resource = new registerForAuction_1.RegisterForAuctionResource(httpClient);
beforeEach(() => {
    mockFetch.mockReset();
});
const registrationPageFixture = {
    alreadyRegistered: false,
    spendingLimitRequired: true,
    auctioneerCentric: false,
    auctionId: 6,
    metaModel: {
        metaRefresh: false,
        metaTitle: 'Register for Selenium Live Test 1',
        metaDescription: null,
        openGraphData: null
    },
    auctionTerms: '<p>TERMS AND CONDITIONS</p>',
    auctionTitle: 'Selenium Live Test 1',
    alreadyRegisteredText: null,
    auctioneerLogo: null,
    auctioneerName: 'Apex UK',
    registrationText: '<p>Hello sallytest.</p>',
    referer: '/#!/home',
    currency: {
        id: 10,
        name: null,
        code: 'RUB',
        selected: false,
        uuid: '999d613e-8ac0-11ee-ab70-0242c0a88005',
        symbol: '&#1088;&#1091;&#1073;'
    }
};
const rawGetResponse = {
    ...registrationPageFixture,
    metaModel: {
        '@class': '.MetaModel',
        ...registrationPageFixture.metaModel
    },
    currency: {
        '@class': '.CurrencyModel',
        ...registrationPageFixture.currency
    }
};
const postResponseFixture = {
    title: 'Auction Registration Pending',
    content: '<h2>Registration pending</h2>',
    status: 'PENDING',
    paddleNumber: 5001,
    referer: '/auctions/d3f1296c-07f2-11f1-9aef-2a57eaf1d4af'
};
describe('RegisterForAuctionResource', () => {
    describe('v2.get', () => {
        it('should call the correct endpoint with auctionUuid path segment', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(rawGetResponse)
            });
            await resource.v2.get('d3f1296c-07f2-11f1-9aef-2a57eaf1d4af');
            expect(mockFetch).toHaveBeenCalledWith('https://example.com/auction-007/api/v2/registerForAuction/d3f1296c-07f2-11f1-9aef-2a57eaf1d4af', expect.objectContaining({ method: 'GET' }));
        });
        it('should include authorization header in request', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(rawGetResponse)
            });
            await resource.v2.get('d3f1296c-07f2-11f1-9aef-2a57eaf1d4af');
            expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
                headers: expect.objectContaining({
                    'authorization': 'Bearer test-jwt-token'
                })
            }));
        });
        it('should strip @class from response and nested objects', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(rawGetResponse)
            });
            const result = await resource.v2.get('d3f1296c-07f2-11f1-9aef-2a57eaf1d4af');
            expect(result).not.toHaveProperty('@class');
            expect(result.metaModel).not.toHaveProperty('@class');
            expect(result.currency).not.toHaveProperty('@class');
        });
        it('should return registration page data', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(rawGetResponse)
            });
            const result = await resource.v2.get('d3f1296c-07f2-11f1-9aef-2a57eaf1d4af');
            expect(result.alreadyRegistered).toBe(false);
            expect(result.spendingLimitRequired).toBe(true);
            expect(result.auctionTitle).toBe('Selenium Live Test 1');
            expect(result.auctioneerName).toBe('Apex UK');
            expect(result.metaModel.metaTitle).toBe('Register for Selenium Live Test 1');
            expect(result.currency.code).toBe('RUB');
        });
        it('should encode special characters in auctionUuid', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(rawGetResponse)
            });
            await resource.v2.get('test/uuid');
            expect(mockFetch).toHaveBeenCalledWith('https://example.com/auction-007/api/v2/registerForAuction/test%2Fuuid', expect.anything());
        });
        it('should throw BidJSHttpError on error response', async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 406,
                text: () => Promise.resolve(JSON.stringify({
                    '@class': '.ErrorModel',
                    failed: true,
                    field: null,
                    code: '406',
                    message: "Request method 'GET' not supported",
                    loggedIn: false
                }))
            });
            await expect(resource.v2.get('bad-uuid')).rejects.toThrow(errors_1.BidJSHttpError);
        });
    });
    describe('v2.post', () => {
        it('should call the correct endpoint with POST', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(postResponseFixture)
            });
            const request = {
                agreedTerms: true,
                auctionUuid: 'd3f1296c-07f2-11f1-9aef-2a57eaf1d4af',
                referer: '/auctions/d3f1296c-07f2-11f1-9aef-2a57eaf1d4af',
                spendingLimit: 200000,
                userId: 5
            };
            await resource.v2.post(request);
            expect(mockFetch).toHaveBeenCalledWith('https://example.com/auction-007/api/v2/registerForAuction', expect.objectContaining({
                method: 'POST',
                body: JSON.stringify(request)
            }));
        });
        it('should include authorization header in request', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(postResponseFixture)
            });
            await resource.v2.post({
                agreedTerms: true,
                auctionUuid: 'd3f1296c-07f2-11f1-9aef-2a57eaf1d4af',
                referer: '/auctions/d3f1296c-07f2-11f1-9aef-2a57eaf1d4af',
                spendingLimit: 200000,
                userId: 5
            });
            expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
                headers: expect.objectContaining({
                    'authorization': 'Bearer test-jwt-token'
                })
            }));
        });
        it('should return registration response with status and paddle number', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(postResponseFixture)
            });
            const result = await resource.v2.post({
                agreedTerms: true,
                auctionUuid: 'd3f1296c-07f2-11f1-9aef-2a57eaf1d4af',
                referer: '/auctions/d3f1296c-07f2-11f1-9aef-2a57eaf1d4af',
                spendingLimit: 200000,
                userId: 5
            });
            expect(result.title).toBe('Auction Registration Pending');
            expect(result.status).toBe('PENDING');
            expect(result.paddleNumber).toBe(5001);
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
            await expect(resource.v2.post({
                agreedTerms: true,
                auctionUuid: 'd3f1296c-07f2-11f1-9aef-2a57eaf1d4af',
                referer: '/auctions/d3f1296c-07f2-11f1-9aef-2a57eaf1d4af',
                spendingLimit: 200000,
                userId: 5
            })).rejects.toThrow(errors_1.BidJSHttpError);
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
            await expect(resource.v2.post({
                agreedTerms: true,
                auctionUuid: 'd3f1296c-07f2-11f1-9aef-2a57eaf1d4af',
                referer: '/auctions/d3f1296c-07f2-11f1-9aef-2a57eaf1d4af',
                spendingLimit: 200000,
                userId: 0
            })).rejects.toThrow(errors_1.BidJSHttpError);
        });
    });
});
//# sourceMappingURL=registerForAuction.test.js.map
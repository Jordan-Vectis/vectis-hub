"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const token_1 = require("./token");
const http_client_1 = require("../../http/http-client");
const errors_1 = require("../../http/errors");
const mockFetch = jest.fn();
global.fetch = mockFetch;
const httpClient = new http_client_1.HttpClient({
    baseUrl: 'https://example.com',
    headers: { 'x-forwarded-client-id': 'auction' }
});
const resource = new token_1.TokenResource(httpClient);
beforeEach(() => {
    mockFetch.mockReset();
});
const addressFixture = {
    id: 604730,
    version: 1,
    addressType: 0,
    addressLine1: '1',
    addressLine2: 'Centre_Ville',
    addressLine3: null,
    addressLine4: null,
    city: 'Brighthelmstone',
    county: 'Sussex',
    postcode: 'BN11AA',
    countryId: 232,
    countryCode: 'UK',
    countryName: null,
    continentId: 0,
    continentCode: null,
    latitude: '000000000000',
    longitude: '000000000000'
};
const userFixture = {
    id: 60334,
    externalUserRef: null,
    language: {
        id: 1,
        name: 'English',
        code: 'en',
        selected: false,
        uuid: null
    },
    timeZone: {
        id: 3,
        name: '(GMT) (GMT) UTC',
        code: 'Europe/London',
        selected: false,
        uuid: null,
        zone: null
    },
    signupSource: null,
    securityQuestion: null,
    webAppId: 1,
    statusId: 5,
    uuid: 'cc22e9ec-934e-11ea-a6c8-06ef874d2a1c',
    redFlag: false,
    redFlagReason: null,
    whitelist: false,
    username: 'stevegullon',
    forename: 'Steve',
    surname: 'Gullon',
    companyName: null,
    inserted: 1325419200000,
    updated: null,
    activated: null,
    lastLoggedIn: 'Feb 12, 2026 09:13 UTC',
    penultimateLogin: 'Feb 12, 2026 09:12 UTC',
    protectedResources: null,
    localeFormat: 'en_GB',
    localeInternal: 'en',
    thousandsSeparator: ',',
    currencySymbolAsPrefix: true,
    loginAdminError: false,
    systemAdmin: true,
    adminLoggedIn: false,
    adminLoginPermitted: true,
    accountNonLocked: true,
    enabled: true,
    credentialsNonExpired: true,
    accountNonExpired: true,
    outbidEmailsOk: false,
    receiveEmailsOk: false,
    forcePasswordReset: false,
    publicVendorAdmin: true,
    mainAddress: { ...addressFixture },
    shippingAddress: { ...addressFixture, id: 126136, version: 16 },
    billingAddress: null,
    hasMainAddress: true,
    hasShippingAddress: true,
    hasBillingAddress: false,
    phoneVerified: false,
    verifiedPhoneNumber: '0770000000',
    auctioneerModels: null,
    accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test-token',
    loginFromBlade: false,
    loginFromBladeUrl: null,
    bladeClientLogo: null,
    displayName: 'stevegullon'
};
const rawResponse = {
    '@class': '.UserModel',
    ...userFixture,
    password: '$2a$10$hashedpassword',
    language: {
        '@class': '.LanguageModel',
        ...userFixture.language
    },
    timeZone: {
        '@class': '.TimeZoneModel',
        ...userFixture.timeZone
    },
    mainAddress: {
        '@class': '.AddressModel',
        ...userFixture.mainAddress
    },
    shippingAddress: {
        '@class': '.AddressModel',
        ...userFixture.shippingAddress
    }
};
describe('TokenResource', () => {
    it('should call the correct endpoint with POST', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(rawResponse)
        });
        await resource.v1.post({ username: 'stevegullon', password: 'secret123' });
        expect(mockFetch).toHaveBeenCalledWith('https://example.com/auction-007/api/v1/token', expect.objectContaining({ method: 'POST' }));
    });
    it('should send credentials with @class in request body', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(rawResponse)
        });
        await resource.v1.post({ username: 'stevegullon', password: 'secret123' });
        expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
            body: JSON.stringify({
                '@class': 'com.bidlogix.scaffold.models.user.LoginModel',
                username: 'stevegullon',
                password: 'secret123'
            })
        }));
    });
    it('should strip @class from response and nested objects', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(rawResponse)
        });
        const result = await resource.v1.post({ username: 'stevegullon', password: 'secret123' });
        expect(result).not.toHaveProperty('@class');
        expect(result.language).not.toHaveProperty('@class');
        expect(result.timeZone).not.toHaveProperty('@class');
        expect(result.mainAddress).not.toHaveProperty('@class');
        expect(result.shippingAddress).not.toHaveProperty('@class');
    });
    it('should strip password from response', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(rawResponse)
        });
        const result = await resource.v1.post({ username: 'stevegullon', password: 'secret123' });
        expect(result).not.toHaveProperty('password');
    });
    it('should return user model with access token and user details', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(rawResponse)
        });
        const result = await resource.v1.post({ username: 'stevegullon', password: 'secret123' });
        expect(result.id).toBe(60334);
        expect(result.uuid).toBe('cc22e9ec-934e-11ea-a6c8-06ef874d2a1c');
        expect(result.username).toBe('stevegullon');
        expect(result.forename).toBe('Steve');
        expect(result.surname).toBe('Gullon');
        expect(result.accessToken).toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
        expect(result.displayName).toBe('stevegullon');
        expect(result.language.code).toBe('en');
        expect(result.timeZone.code).toBe('Europe/London');
        expect(result.mainAddress.city).toBe('Brighthelmstone');
        expect(result.billingAddress).toBeNull();
    });
    it('should throw BidJSHttpError on authentication failure', async () => {
        const errorBody = JSON.stringify({
            '@class': '.ErrorModel',
            failed: true,
            field: null,
            code: '403',
            message: 'Access Denied',
            loggedIn: false
        });
        mockFetch.mockResolvedValue({
            ok: false,
            status: 403,
            text: () => Promise.resolve(errorBody)
        });
        await expect(resource.v1.post({ username: 'wrong', password: 'wrong' })).rejects.toThrow(errors_1.BidJSHttpError);
    });
});
//# sourceMappingURL=token.test.js.map
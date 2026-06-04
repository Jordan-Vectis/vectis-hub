"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const model_1 = require("./model");
const http_client_1 = require("../../http/http-client");
const mockFetch = jest.fn();
global.fetch = mockFetch;
const httpClient = new http_client_1.HttpClient({
    baseUrl: 'https://example.com',
    headers: { 'x-forwarded-client-id': 'auction' }
});
const resource = new model_1.ModelResource(httpClient);
beforeEach(() => {
    mockFetch.mockReset();
});
describe('ModelResource', () => {
    it('should call the correct endpoint', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ '@class': '.CoreBladeModel', keyMap: {} })
        });
        await resource.v1.get();
        expect(mockFetch).toHaveBeenCalledWith('https://example.com/auction-007/api/v1/models', expect.objectContaining({ method: 'GET' }));
    });
    it('should strip @class fields from response', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                '@class': '.CoreBladeModel',
                keyMap: { KEY: 'value' },
                userModel: {
                    '@class': '.UserModel',
                    username: 'test@example.com'
                }
            })
        });
        const result = await resource.v1.get();
        expect(result).not.toHaveProperty('@class');
        expect(result.userModel).not.toHaveProperty('@class');
        expect(result.keyMap).toEqual({ KEY: 'value' });
        expect(result.userModel.username).toBe('test@example.com');
    });
    it('should strip jacksonString from response', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                '@class': '.CoreBladeModel',
                keyMap: {},
                jacksonString: '{"@class":".StatusModel"}',
                statusModel: { '@class': '.StatusModel', bidStatuses: {} }
            })
        });
        const result = await resource.v1.get();
        expect(result).not.toHaveProperty('jacksonString');
        expect(result).not.toHaveProperty('@class');
    });
    it('should return accountIconsModel when present', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                '@class': '.CoreBladeModel',
                keyMap: {},
                accountIconsModel: {
                    '@class': '.AccountIconsModel',
                    bidsLosingCount: 2,
                    unpaidInvoiceCount: 1,
                    unreadMessagesCount: 3,
                    pendingOffersCount: 0
                }
            })
        });
        const result = await resource.v1.get();
        expect(result.accountIconsModel).not.toHaveProperty('@class');
        expect(result.accountIconsModel).toEqual({
            bidsLosingCount: 2,
            unpaidInvoiceCount: 1,
            unreadMessagesCount: 3,
            pendingOffersCount: 0
        });
    });
    it('should return accountIconsModel as null when not present', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                '@class': '.CoreBladeModel',
                keyMap: {},
                accountIconsModel: null
            })
        });
        const result = await resource.v1.get();
        expect(result.accountIconsModel).toBeNull();
    });
    it('should strip phone verification fields from webAppModel.options', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                '@class': '.CoreBladeModel',
                keyMap: {},
                webAppModel: {
                    options: {
                        phoneVerificationEnabled: true,
                        phoneVerificationUrl: 'https://verify.example.com',
                        phoneVerificationBrand: 'BrandX',
                        phoneVerificationApiKey: 'pv-key-secret',
                        phoneVerificationApiSecret: 'pv-secret-value',
                        useGalleryLayoutForBidding: false
                    }
                }
            })
        });
        const result = await resource.v1.get();
        expect(result.webAppModel.options).not.toHaveProperty('phoneVerificationEnabled');
        expect(result.webAppModel.options).not.toHaveProperty('phoneVerificationUrl');
        expect(result.webAppModel.options).not.toHaveProperty('phoneVerificationBrand');
        expect(result.webAppModel.options).not.toHaveProperty('phoneVerificationApiKey');
        expect(result.webAppModel.options).not.toHaveProperty('phoneVerificationApiSecret');
        expect(result.webAppModel.options.useGalleryLayoutForBidding).toBe(false);
    });
    it('should strip password from userModel', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                '@class': '.CoreBladeModel',
                keyMap: {},
                userModel: {
                    username: 'test@example.com',
                    password: '$2a$10$hashedpassword'
                }
            })
        });
        const result = await resource.v1.get();
        expect(result.userModel).not.toHaveProperty('password');
        expect(result.userModel.username).toBe('test@example.com');
    });
    it('should strip @class from deeply nested objects and arrays', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                '@class': '.CoreBladeModel',
                keyMap: {},
                webAppModel: {
                    '@class': '.WebAppModel',
                    partners: [
                        { '@class': '.PartnerWebAppModel', id: 1, url: 'https://example.com' },
                        { '@class': '.PartnerWebAppModel', id: 2, url: 'https://other.com' }
                    ]
                }
            })
        });
        const result = await resource.v1.get();
        expect(result.webAppModel).not.toHaveProperty('@class');
        expect(result.webAppModel.partners[0]).not.toHaveProperty('@class');
        expect(result.webAppModel.partners[0].id).toBe(1);
        expect(result.webAppModel.partners[1].id).toBe(2);
    });
});
//# sourceMappingURL=model.test.js.map
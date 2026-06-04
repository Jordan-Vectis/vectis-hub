"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = __importStar(require("./index"));
const mockFetch = jest.fn();
global.fetch = mockFetch;
beforeEach(() => {
    mockFetch.mockReset();
});
const stagingConfig = {
    clientId: 'auction',
    region: 'eu-west-2',
    host: 'lewes-staging',
    isProduction: false,
    language: 'en-GB,en-US'
};
const prodConfig = {
    clientId: 'auction',
    region: 'eu-west-2',
    host: 'lewes',
    isProduction: true,
    language: 'en-GB'
};
describe('BidJS', () => {
    describe('constructor', () => {
        it('should expose public namespace', () => {
            const bidjs = new index_1.default(stagingConfig);
            expect(bidjs.public).toBeInstanceOf(index_1.PublicNamespace);
        });
        it('should expose socket namespace', () => {
            const bidjs = new index_1.default(stagingConfig);
            expect(bidjs.socket).toBeInstanceOf(index_1.SocketNamespace);
        });
    });
    describe('integration', () => {
        it('should send correct headers when making public requests', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ keyMap: {} })
            });
            const bidjs = new index_1.default(stagingConfig);
            await bidjs.public.models.v1.get();
            expect(mockFetch).toHaveBeenCalledWith('https://lewes-staging.eu-west-2.staging.bidjs.com/auction-007/api/v1/models', expect.objectContaining({
                headers: {
                    'x-forwarded-client-id': 'auction',
                    'accept-language': 'en-GB,en-US'
                }
            }));
        });
        it('should send correct URL for auction requests', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    information: { auction: { uuid: 'test-uuid' } },
                    sellingInformation: {},
                    attachments: {},
                    webcastInformation: null
                })
            });
            const bidjs = new index_1.default(prodConfig);
            await bidjs.public.auction.v3.get('test-uuid');
            expect(mockFetch).toHaveBeenCalledWith('https://lewes.eu-west-2.bidjs.com/auction-007/api/v3/auctions/test-uuid', expect.anything());
        });
    });
    describe('setAccessToken', () => {
        it('should add authorization header to public client requests', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ keyMap: {} })
            });
            const bidjs = new index_1.default(stagingConfig);
            bidjs.setAccessToken('my-jwt-token');
            await bidjs.public.models.v1.get();
            expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
                headers: expect.objectContaining({
                    'authorization': 'Bearer my-jwt-token'
                })
            }));
        });
        it('should remove authorization header after clearAccessToken', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ keyMap: {} })
            });
            const bidjs = new index_1.default(stagingConfig);
            bidjs.setAccessToken('my-jwt-token');
            bidjs.clearAccessToken();
            await bidjs.public.models.v1.get();
            expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
                headers: {
                    'x-forwarded-client-id': 'auction',
                    'accept-language': 'en-GB,en-US'
                }
            }));
        });
    });
    describe('re-exports', () => {
        it('should export error classes', () => {
            expect(index_1.BidJSError).toBeDefined();
            expect(index_1.BidJSHttpError).toBeDefined();
        });
        it('should export default BidJS class', () => {
            expect(index_1.default).toBeDefined();
        });
        it('should export all named classes and utilities', () => {
            expect(index_1.HttpClient).toBeDefined();
            expect(index_1.buildPublicBaseUrl).toBeDefined();
            expect(index_1.ModelResource).toBeDefined();
            expect(index_1.AuctionResource).toBeDefined();
            expect(index_1.TokenResource).toBeDefined();
            expect(index_1.RegisterForAuctionResource).toBeDefined();
            expect(index_1.TimedNamespace).toBeDefined();
            expect(index_1.BidResource).toBeDefined();
            expect(index_1.AutoBidResource).toBeDefined();
            expect(index_1.HomeResource).toBeDefined();
            expect(index_1.WebSocketClient).toBeDefined();
            expect(index_1.SocketNamespace).toBeDefined();
        });
    });
});
//# sourceMappingURL=index.test.js.map
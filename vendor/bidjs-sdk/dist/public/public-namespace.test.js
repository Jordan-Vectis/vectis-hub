"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const public_namespace_1 = require("./public-namespace");
const http_client_1 = require("../http/http-client");
const model_1 = require("./model/model");
const auction_1 = require("./auction/auction");
const token_1 = require("./token/token");
const registerForAuction_1 = require("./registerForAuction/registerForAuction");
describe('PublicNamespace', () => {
    const httpClient = new http_client_1.HttpClient({
        baseUrl: 'https://example.com',
        headers: { 'x-forwarded-client-id': 'auction' }
    });
    const pub = new public_namespace_1.PublicNamespace(httpClient);
    it('should construct with an HttpClient', () => {
        expect(pub).toBeInstanceOf(public_namespace_1.PublicNamespace);
    });
    it('should expose models resource', () => {
        expect(pub.models).toBeInstanceOf(model_1.ModelResource);
    });
    it('should expose auction resource', () => {
        expect(pub.auction).toBeInstanceOf(auction_1.AuctionResource);
    });
    it('should expose token resource', () => {
        expect(pub.token).toBeInstanceOf(token_1.TokenResource);
    });
    it('should expose registerForAuction resource', () => {
        expect(pub.registerForAuction).toBeInstanceOf(registerForAuction_1.RegisterForAuctionResource);
    });
});
//# sourceMappingURL=public-namespace.test.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const url_builder_1 = require("./url-builder");
const stagingConfig = {
    clientId: 'auction',
    region: 'eu-west-2',
    host: 'lewes-staging',
    isProduction: false,
    language: 'en-GB'
};
const prodConfig = {
    clientId: 'auction',
    region: 'eu-west-2',
    host: 'lewes',
    isProduction: true,
    language: 'en-GB'
};
describe('buildPublicBaseUrl', () => {
    it('should build staging URL', () => {
        expect((0, url_builder_1.buildPublicBaseUrl)(stagingConfig)).toBe('https://lewes-staging.eu-west-2.staging.bidjs.com');
    });
    it('should build production URL', () => {
        expect((0, url_builder_1.buildPublicBaseUrl)(prodConfig)).toBe('https://lewes.eu-west-2.bidjs.com');
    });
});
//# sourceMappingURL=url-builder.test.js.map
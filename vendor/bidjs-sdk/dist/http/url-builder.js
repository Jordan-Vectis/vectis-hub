"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPublicBaseUrl = buildPublicBaseUrl;
exports.buildBroadcastUrl = buildBroadcastUrl;
function buildPublicBaseUrl(config) {
    const domain = config.isProduction
        ? `${config.host}.${config.region}.bidjs.com`
        : `${config.host}.${config.region}.staging.bidjs.com`;
    return `https://${domain}`;
}
function buildBroadcastUrl(config) {
    const domain = config.isProduction
        ? `broadcast.${config.region}.bidjs.com`
        : `develop-broadcast.${config.region}.staging.bidjs.com`;
    return `wss://${domain}`;
}
//# sourceMappingURL=url-builder.js.map
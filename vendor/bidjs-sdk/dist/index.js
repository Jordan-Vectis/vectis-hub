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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocketNamespace = exports.WebSocketClient = exports.HomeResource = exports.AutoBidResource = exports.BidResource = exports.TimedNamespace = exports.RegisterForAuctionResource = exports.TokenResource = exports.AuctionResource = exports.ModelResource = exports.PublicNamespace = exports.buildPublicBaseUrl = exports.HttpClient = exports.BidJSHttpError = exports.BidJSError = exports.BidJS = void 0;
const http_client_1 = require("./http/http-client");
const url_builder_1 = require("./http/url-builder");
const public_namespace_1 = require("./public/public-namespace");
const websocket_1 = require("./websocket");
/**
 * Main entry point for the BidJS SDK.
 *
 * Each instance is bound to a single `clientId`, `language`.
 * Authentication state set via {@link setAccessToken} is stored on the instance.
 *
 * **Important:** Do not share a single `BidJS` instance across multiple users.
 * In server-side environments, create one instance per user/request context to
 * avoid token mix-ups between concurrent requests.
 */
class BidJS {
    constructor(config) {
        this.publicClient = new http_client_1.HttpClient({
            baseUrl: (0, url_builder_1.buildPublicBaseUrl)(config),
            headers: {
                'x-forwarded-client-id': config.clientId,
                'accept-language': config.language
            }
        });
        this.public = new public_namespace_1.PublicNamespace(this.publicClient);
        this.socket = new websocket_1.SocketNamespace((0, url_builder_1.buildBroadcastUrl)(config));
    }
    setAccessToken(token) {
        this.publicClient.setAccessToken(token);
    }
    clearAccessToken() {
        this.publicClient.clearAccessToken();
    }
}
exports.BidJS = BidJS;
exports.default = BidJS;
var errors_1 = require("./http/errors");
Object.defineProperty(exports, "BidJSError", { enumerable: true, get: function () { return errors_1.BidJSError; } });
Object.defineProperty(exports, "BidJSHttpError", { enumerable: true, get: function () { return errors_1.BidJSHttpError; } });
var http_client_2 = require("./http/http-client");
Object.defineProperty(exports, "HttpClient", { enumerable: true, get: function () { return http_client_2.HttpClient; } });
var url_builder_2 = require("./http/url-builder");
Object.defineProperty(exports, "buildPublicBaseUrl", { enumerable: true, get: function () { return url_builder_2.buildPublicBaseUrl; } });
var public_namespace_2 = require("./public/public-namespace");
Object.defineProperty(exports, "PublicNamespace", { enumerable: true, get: function () { return public_namespace_2.PublicNamespace; } });
var model_1 = require("./public/model/model");
Object.defineProperty(exports, "ModelResource", { enumerable: true, get: function () { return model_1.ModelResource; } });
var auction_1 = require("./public/auction/auction");
Object.defineProperty(exports, "AuctionResource", { enumerable: true, get: function () { return auction_1.AuctionResource; } });
var token_1 = require("./public/token/token");
Object.defineProperty(exports, "TokenResource", { enumerable: true, get: function () { return token_1.TokenResource; } });
var registerForAuction_1 = require("./public/registerForAuction/registerForAuction");
Object.defineProperty(exports, "RegisterForAuctionResource", { enumerable: true, get: function () { return registerForAuction_1.RegisterForAuctionResource; } });
var timedNamespace_1 = require("./public/timed/timedNamespace");
Object.defineProperty(exports, "TimedNamespace", { enumerable: true, get: function () { return timedNamespace_1.TimedNamespace; } });
var bid_1 = require("./public/timed/bid/bid");
Object.defineProperty(exports, "BidResource", { enumerable: true, get: function () { return bid_1.BidResource; } });
var autoBid_1 = require("./public/timed/autoBid/autoBid");
Object.defineProperty(exports, "AutoBidResource", { enumerable: true, get: function () { return autoBid_1.AutoBidResource; } });
var home_1 = require("./public/home/home");
Object.defineProperty(exports, "HomeResource", { enumerable: true, get: function () { return home_1.HomeResource; } });
var webSocketClient_1 = require("./websocket/webSocketClient");
Object.defineProperty(exports, "WebSocketClient", { enumerable: true, get: function () { return webSocketClient_1.WebSocketClient; } });
var socketNamespace_1 = require("./websocket/socketNamespace");
Object.defineProperty(exports, "SocketNamespace", { enumerable: true, get: function () { return socketNamespace_1.SocketNamespace; } });
__exportStar(require("./public/model/model.types"), exports);
__exportStar(require("./public/auction/auction.types"), exports);
__exportStar(require("./public/token/token.types"), exports);
__exportStar(require("./public/registerForAuction/registerForAuction.types"), exports);
__exportStar(require("./public/timed/timed.types"), exports);
__exportStar(require("./public/home/home.types"), exports);
//# sourceMappingURL=index.js.map
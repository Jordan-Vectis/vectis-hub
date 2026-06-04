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
exports.SocketNamespace = exports.WebSocketClient = void 0;
var webSocketClient_1 = require("./webSocketClient");
Object.defineProperty(exports, "WebSocketClient", { enumerable: true, get: function () { return webSocketClient_1.WebSocketClient; } });
var socketNamespace_1 = require("./socketNamespace");
Object.defineProperty(exports, "SocketNamespace", { enumerable: true, get: function () { return socketNamespace_1.SocketNamespace; } });
__exportStar(require("./types"), exports);
//# sourceMappingURL=index.js.map
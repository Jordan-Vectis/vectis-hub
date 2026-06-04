"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PingManager = void 0;
class PingManager {
    constructor(config) {
        this.intervalId = null;
        this.timeoutId = null;
        this.intervalMs = config.intervalMs;
        this.timeoutMs = config.timeoutMs;
    }
    start(sendFn, onTimeoutFn) {
        this.stop();
        this.intervalId = setInterval(() => {
            sendFn();
            if (this.timeoutId) {
                clearTimeout(this.timeoutId);
            }
            this.timeoutId = setTimeout(() => {
                onTimeoutFn();
            }, this.timeoutMs);
        }, this.intervalMs);
    }
    receivedPong() {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
    }
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
    }
}
exports.PingManager = PingManager;
//# sourceMappingURL=pingManager.js.map
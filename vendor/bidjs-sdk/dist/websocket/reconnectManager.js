"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReconnectManager = void 0;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;
function calculateDelay(strategy, attempt) {
    switch (strategy) {
        case 'constant':
            return BASE_DELAY_MS;
        case 'linear':
            return BASE_DELAY_MS * attempt;
        case 'exponential': {
            const base = BASE_DELAY_MS * Math.pow(2, attempt - 1);
            const jitter = Math.random() * BASE_DELAY_MS;
            return Math.min(base + jitter, MAX_DELAY_MS);
        }
    }
}
class ReconnectManager {
    constructor(config) {
        this.attemptCount = 0;
        this.timerId = null;
        this.strategy = config.strategy;
        this.maxAttempts = config.maxAttempts;
    }
    get attempts() {
        return this.attemptCount;
    }
    scheduleReconnect(connectFn) {
        if (this.maxAttempts !== null && this.attemptCount >= this.maxAttempts) {
            return false;
        }
        this.attemptCount++;
        const delay = calculateDelay(this.strategy, this.attemptCount);
        this.timerId = setTimeout(() => {
            this.timerId = null;
            connectFn();
        }, delay);
        return true;
    }
    reset() {
        this.attemptCount = 0;
    }
    stop() {
        if (this.timerId) {
            clearTimeout(this.timerId);
            this.timerId = null;
        }
    }
}
exports.ReconnectManager = ReconnectManager;
//# sourceMappingURL=reconnectManager.js.map
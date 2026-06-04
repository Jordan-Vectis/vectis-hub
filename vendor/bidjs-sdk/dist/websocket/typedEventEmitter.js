"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TypedEventEmitter = void 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
class TypedEventEmitter {
    constructor() {
        this.listeners = new Map();
    }
    on(event, listener) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(listener);
    }
    once(event, listener) {
        const wrapper = ((data) => {
            this.off(event, wrapper);
            listener(data);
        });
        this.on(event, wrapper);
    }
    off(event, listener) {
        const set = this.listeners.get(event);
        if (set) {
            set.delete(listener);
        }
    }
    emit(event, data) {
        const set = this.listeners.get(event);
        if (set) {
            for (const listener of set) {
                listener(data);
            }
        }
    }
    removeAllListeners(event) {
        if (event) {
            this.listeners.delete(event);
        }
        else {
            this.listeners.clear();
        }
    }
}
exports.TypedEventEmitter = TypedEventEmitter;
//# sourceMappingURL=typedEventEmitter.js.map
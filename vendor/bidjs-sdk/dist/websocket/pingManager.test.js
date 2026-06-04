"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const pingManager_1 = require("./pingManager");
beforeEach(() => {
    jest.useFakeTimers();
});
afterEach(() => {
    jest.useRealTimers();
});
describe('PingManager', () => {
    it('should send ping at configured interval', () => {
        const sendFn = jest.fn();
        const onTimeoutFn = jest.fn();
        const manager = new pingManager_1.PingManager({ intervalMs: 6000, timeoutMs: 5000 });
        manager.start(sendFn, onTimeoutFn);
        jest.advanceTimersByTime(6000);
        expect(sendFn).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(6000);
        expect(sendFn).toHaveBeenCalledTimes(2);
        manager.stop();
    });
    it('should call timeout callback if pong not received', () => {
        const sendFn = jest.fn();
        const onTimeoutFn = jest.fn();
        const manager = new pingManager_1.PingManager({ intervalMs: 6000, timeoutMs: 5000 });
        manager.start(sendFn, onTimeoutFn);
        jest.advanceTimersByTime(6000);
        expect(sendFn).toHaveBeenCalledTimes(1);
        expect(onTimeoutFn).not.toHaveBeenCalled();
        jest.advanceTimersByTime(5000);
        expect(onTimeoutFn).toHaveBeenCalledTimes(1);
        manager.stop();
    });
    it('should clear timeout when receivedPong is called', () => {
        const sendFn = jest.fn();
        const onTimeoutFn = jest.fn();
        const manager = new pingManager_1.PingManager({ intervalMs: 6000, timeoutMs: 5000 });
        manager.start(sendFn, onTimeoutFn);
        jest.advanceTimersByTime(6000);
        manager.receivedPong();
        jest.advanceTimersByTime(5000);
        expect(onTimeoutFn).not.toHaveBeenCalled();
        manager.stop();
    });
    it('should stop all timers on stop', () => {
        const sendFn = jest.fn();
        const onTimeoutFn = jest.fn();
        const manager = new pingManager_1.PingManager({ intervalMs: 6000, timeoutMs: 5000 });
        manager.start(sendFn, onTimeoutFn);
        manager.stop();
        jest.advanceTimersByTime(12000);
        expect(sendFn).not.toHaveBeenCalled();
        expect(onTimeoutFn).not.toHaveBeenCalled();
    });
    it('should not false-timeout when pingIntervalMs < pongTimeoutMs', () => {
        const sendFn = jest.fn();
        const onTimeoutFn = jest.fn();
        const manager = new pingManager_1.PingManager({ intervalMs: 3000, timeoutMs: 5000 });
        manager.start(sendFn, onTimeoutFn);
        // First ping at 3000ms
        jest.advanceTimersByTime(3000);
        expect(sendFn).toHaveBeenCalledTimes(1);
        // Second ping at 6000ms — before first timeout (5000ms) would fire
        jest.advanceTimersByTime(3000);
        expect(sendFn).toHaveBeenCalledTimes(2);
        // Pong received for second ping
        manager.receivedPong();
        // Advance past where the first orphaned timeout would have fired
        jest.advanceTimersByTime(5000);
        expect(onTimeoutFn).not.toHaveBeenCalled();
        manager.stop();
    });
    it('should restart cleanly after stop and start', () => {
        const sendFn = jest.fn();
        const onTimeoutFn = jest.fn();
        const manager = new pingManager_1.PingManager({ intervalMs: 6000, timeoutMs: 5000 });
        manager.start(sendFn, onTimeoutFn);
        manager.stop();
        manager.start(sendFn, onTimeoutFn);
        jest.advanceTimersByTime(6000);
        expect(sendFn).toHaveBeenCalledTimes(1);
        manager.stop();
    });
});
//# sourceMappingURL=pingManager.test.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const reconnectManager_1 = require("./reconnectManager");
beforeEach(() => {
    jest.useFakeTimers();
});
afterEach(() => {
    jest.useRealTimers();
});
describe('ReconnectManager', () => {
    describe('constant strategy', () => {
        it('should use fixed delay for every attempt', () => {
            const connectFn = jest.fn();
            const manager = new reconnectManager_1.ReconnectManager({ strategy: 'constant', maxAttempts: null });
            manager.scheduleReconnect(connectFn);
            jest.advanceTimersByTime(1000);
            expect(connectFn).toHaveBeenCalledTimes(1);
            manager.scheduleReconnect(connectFn);
            jest.advanceTimersByTime(1000);
            expect(connectFn).toHaveBeenCalledTimes(2);
            manager.scheduleReconnect(connectFn);
            jest.advanceTimersByTime(1000);
            expect(connectFn).toHaveBeenCalledTimes(3);
            manager.stop();
        });
    });
    describe('linear strategy', () => {
        it('should increase delay by fixed increment each attempt', () => {
            const connectFn = jest.fn();
            const manager = new reconnectManager_1.ReconnectManager({ strategy: 'linear', maxAttempts: null });
            manager.scheduleReconnect(connectFn);
            jest.advanceTimersByTime(999);
            expect(connectFn).not.toHaveBeenCalled();
            jest.advanceTimersByTime(1);
            expect(connectFn).toHaveBeenCalledTimes(1);
            manager.scheduleReconnect(connectFn);
            jest.advanceTimersByTime(1999);
            expect(connectFn).toHaveBeenCalledTimes(1);
            jest.advanceTimersByTime(1);
            expect(connectFn).toHaveBeenCalledTimes(2);
            manager.scheduleReconnect(connectFn);
            jest.advanceTimersByTime(2999);
            expect(connectFn).toHaveBeenCalledTimes(2);
            jest.advanceTimersByTime(1);
            expect(connectFn).toHaveBeenCalledTimes(3);
            manager.stop();
        });
    });
    describe('exponential strategy', () => {
        it('should produce increasing delays capped at 30s', () => {
            jest.spyOn(Math, 'random').mockReturnValue(0);
            const connectFn = jest.fn();
            const manager = new reconnectManager_1.ReconnectManager({ strategy: 'exponential', maxAttempts: null });
            manager.scheduleReconnect(connectFn);
            jest.advanceTimersByTime(1000);
            expect(connectFn).toHaveBeenCalledTimes(1);
            manager.scheduleReconnect(connectFn);
            jest.advanceTimersByTime(2000);
            expect(connectFn).toHaveBeenCalledTimes(2);
            manager.scheduleReconnect(connectFn);
            jest.advanceTimersByTime(4000);
            expect(connectFn).toHaveBeenCalledTimes(3);
            manager.scheduleReconnect(connectFn);
            jest.advanceTimersByTime(8000);
            expect(connectFn).toHaveBeenCalledTimes(4);
            manager.stop();
            jest.spyOn(Math, 'random').mockRestore();
        });
        it('should cap delay at 30 seconds', () => {
            jest.spyOn(Math, 'random').mockReturnValue(0);
            const connectFn = jest.fn();
            const manager = new reconnectManager_1.ReconnectManager({ strategy: 'exponential', maxAttempts: null });
            for (let i = 0; i < 10; i++) {
                manager.scheduleReconnect(connectFn);
                jest.advanceTimersByTime(30000);
            }
            expect(connectFn).toHaveBeenCalledTimes(10);
            manager.stop();
            jest.spyOn(Math, 'random').mockRestore();
        });
    });
    describe('maxAttempts', () => {
        it('should respect max attempts and return false when exceeded', () => {
            const connectFn = jest.fn();
            const manager = new reconnectManager_1.ReconnectManager({ strategy: 'constant', maxAttempts: 2 });
            expect(manager.scheduleReconnect(connectFn)).toBe(true);
            jest.advanceTimersByTime(1000);
            expect(connectFn).toHaveBeenCalledTimes(1);
            expect(manager.scheduleReconnect(connectFn)).toBe(true);
            jest.advanceTimersByTime(1000);
            expect(connectFn).toHaveBeenCalledTimes(2);
            expect(manager.scheduleReconnect(connectFn)).toBe(false);
            jest.advanceTimersByTime(10000);
            expect(connectFn).toHaveBeenCalledTimes(2);
            manager.stop();
        });
        it('should allow infinite attempts when maxAttempts is null', () => {
            const connectFn = jest.fn();
            const manager = new reconnectManager_1.ReconnectManager({ strategy: 'constant', maxAttempts: null });
            for (let i = 0; i < 100; i++) {
                expect(manager.scheduleReconnect(connectFn)).toBe(true);
                jest.advanceTimersByTime(1000);
            }
            expect(connectFn).toHaveBeenCalledTimes(100);
            manager.stop();
        });
    });
    describe('attempts getter', () => {
        it('should track attempt count', () => {
            const connectFn = jest.fn();
            const manager = new reconnectManager_1.ReconnectManager({ strategy: 'constant', maxAttempts: null });
            expect(manager.attempts).toBe(0);
            manager.scheduleReconnect(connectFn);
            expect(manager.attempts).toBe(1);
            jest.advanceTimersByTime(1000);
            manager.scheduleReconnect(connectFn);
            expect(manager.attempts).toBe(2);
            manager.stop();
        });
    });
    describe('reset', () => {
        it('should clear attempt count', () => {
            const connectFn = jest.fn();
            const manager = new reconnectManager_1.ReconnectManager({ strategy: 'constant', maxAttempts: 3 });
            manager.scheduleReconnect(connectFn);
            jest.advanceTimersByTime(1000);
            manager.scheduleReconnect(connectFn);
            jest.advanceTimersByTime(1000);
            expect(manager.attempts).toBe(2);
            manager.reset();
            expect(manager.attempts).toBe(0);
            expect(manager.scheduleReconnect(connectFn)).toBe(true);
            jest.advanceTimersByTime(1000);
            expect(connectFn).toHaveBeenCalledTimes(3);
            manager.stop();
        });
    });
    describe('stop', () => {
        it('should cancel pending reconnect', () => {
            const connectFn = jest.fn();
            const manager = new reconnectManager_1.ReconnectManager({ strategy: 'constant', maxAttempts: null });
            manager.scheduleReconnect(connectFn);
            manager.stop();
            jest.advanceTimersByTime(10000);
            expect(connectFn).not.toHaveBeenCalled();
        });
    });
});
//# sourceMappingURL=reconnectManager.test.js.map
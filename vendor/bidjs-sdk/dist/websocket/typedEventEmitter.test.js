"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const typedEventEmitter_1 = require("./typedEventEmitter");
let emitter;
beforeEach(() => {
    emitter = new typedEventEmitter_1.TypedEventEmitter();
});
describe('TypedEventEmitter', () => {
    describe('on', () => {
        it('should register and receive events', () => {
            const listener = jest.fn();
            emitter.on('message', listener);
            emitter.emit('message', 'hello');
            expect(listener).toHaveBeenCalledWith('hello');
        });
        it('should support multiple listeners on same event', () => {
            const listener1 = jest.fn();
            const listener2 = jest.fn();
            emitter.on('message', listener1);
            emitter.on('message', listener2);
            emitter.emit('message', 'hello');
            expect(listener1).toHaveBeenCalledWith('hello');
            expect(listener2).toHaveBeenCalledWith('hello');
        });
        it('should not crash when emitting event with no listeners', () => {
            expect(() => emitter.emit('message', 'hello')).not.toThrow();
        });
    });
    describe('once', () => {
        it('should fire exactly once then auto-remove', () => {
            const listener = jest.fn();
            emitter.once('message', listener);
            emitter.emit('message', 'first');
            emitter.emit('message', 'second');
            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith('first');
        });
    });
    describe('off', () => {
        it('should remove a specific listener', () => {
            const listener = jest.fn();
            emitter.on('message', listener);
            emitter.emit('message', 'before');
            emitter.off('message', listener);
            emitter.emit('message', 'after');
            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith('before');
        });
        it('should not affect other listeners on same event', () => {
            const listener1 = jest.fn();
            const listener2 = jest.fn();
            emitter.on('message', listener1);
            emitter.on('message', listener2);
            emitter.off('message', listener1);
            emitter.emit('message', 'hello');
            expect(listener1).not.toHaveBeenCalled();
            expect(listener2).toHaveBeenCalledWith('hello');
        });
    });
    describe('removeAllListeners', () => {
        it('should clear all listeners for a specific event', () => {
            const messageListener = jest.fn();
            const countListener = jest.fn();
            emitter.on('message', messageListener);
            emitter.on('count', countListener);
            emitter.removeAllListeners('message');
            emitter.emit('message', 'hello');
            emitter.emit('count', 42);
            expect(messageListener).not.toHaveBeenCalled();
            expect(countListener).toHaveBeenCalledWith(42);
        });
        it('should clear all listeners when called without arguments', () => {
            const messageListener = jest.fn();
            const countListener = jest.fn();
            emitter.on('message', messageListener);
            emitter.on('count', countListener);
            emitter.removeAllListeners();
            emitter.emit('message', 'hello');
            emitter.emit('count', 42);
            expect(messageListener).not.toHaveBeenCalled();
            expect(countListener).not.toHaveBeenCalled();
        });
    });
});
//# sourceMappingURL=typedEventEmitter.test.js.map
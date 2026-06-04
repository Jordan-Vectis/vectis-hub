type Listener<T> = (data: T) => void;
export declare class TypedEventEmitter<TEvents extends Record<string, any>> {
    private listeners;
    on<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): void;
    once<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): void;
    off<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): void;
    emit<K extends keyof TEvents>(event: K, data: TEvents[K]): void;
    removeAllListeners(event?: keyof TEvents): void;
}
export {};
//# sourceMappingURL=typedEventEmitter.d.ts.map
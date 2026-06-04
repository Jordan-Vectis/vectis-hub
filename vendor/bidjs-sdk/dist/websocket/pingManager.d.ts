export declare class PingManager {
    private readonly intervalMs;
    private readonly timeoutMs;
    private intervalId;
    private timeoutId;
    constructor(config: {
        intervalMs: number;
        timeoutMs: number;
    });
    start(sendFn: () => void, onTimeoutFn: () => void): void;
    receivedPong(): void;
    stop(): void;
}
//# sourceMappingURL=pingManager.d.ts.map
export type ReconnectStrategy = 'exponential' | 'linear' | 'constant';
export declare class ReconnectManager {
    private readonly strategy;
    private readonly maxAttempts;
    private attemptCount;
    private timerId;
    constructor(config: {
        strategy: ReconnectStrategy;
        maxAttempts: number | null;
    });
    get attempts(): number;
    scheduleReconnect(connectFn: () => void): boolean;
    reset(): void;
    stop(): void;
}
//# sourceMappingURL=reconnectManager.d.ts.map
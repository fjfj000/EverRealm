/**
 * 需要持久化的真实计时。
 * 只存累计真实游戏时间。单次时间不进存档，每次开始游玩时从 0 计。
 * 这里不读倍速，也不推动世界。
 */
export interface RealTimeRecord {
    /** 用户累计真实游戏时间，秒。 */
    totalRealTime: number;
}

/**
 * 真实游戏时间。
 * 和世界时钟分开走：暂停游戏、倍速为 0，这条线仍然按真实秒累加。
 * 只有结束本次游玩后才停止。不能用这里的秒数乘倍速去还原游戏时间。
 */
export class RealTimeCounter {
    /** 用户累计真实游戏时间，秒。需要随存档保存。 */
    private _totalRealTime: number = 0;
    /** 本次游玩的真实游戏时间，秒。不进存档，开始新的一次时清零。 */
    private _sessionRealTime: number = 0;
    /** 本次游玩是否还开着。结束游玩后停止累加。 */
    private _sessionActive: boolean = false;

    /** 用户累计真实游戏时间，秒。 */
    public get TotalRealTime(): number {
        return this._totalRealTime;
    }

    /** 本次游玩的真实游戏时间，秒。 */
    public get SessionRealTime(): number {
        return this._sessionRealTime;
    }

    /** 本次游玩是否还在计时。 */
    public get SessionActive(): boolean {
        return this._sessionActive;
    }

    /** 开始新的一次游玩。单次真实时间从 0 计，累计值接着存档涨。 */
    public StartSession(): void {
        this._sessionRealTime = 0;
        this._sessionActive = true;
    }

    /** 结束这一次游玩。单次时间留着给界面看，直到下一次 StartSession。 */
    public StopSession(): void {
        this._sessionActive = false;
    }

    /**
     * 推进一段真实时间。
     * realSeconds 是这段墙上时间里，用户还留在这一次游玩中的秒数。
     * 游戏有没有暂停、倍速是多少，都不影响这里。
     */
    public Tick(realSeconds: number): void {
        if (!this._sessionActive) {
            return;
        }
        if (typeof realSeconds !== "number" || !Number.isFinite(realSeconds) || realSeconds < 0) {
            throw new Error("真实游戏时间增量必须是非负有限数字");
        }
        if (realSeconds === 0) {
            return;
        }
        this._sessionRealTime += realSeconds;
        this._totalRealTime += realSeconds;
    }

    /** 导出需要持久化的累计真实时间。不含本次单次时间。 */
    public Save(): RealTimeRecord {
        return {
            totalRealTime: this._totalRealTime,
        };
    }

    /**
     * 读入存档。
     * 单次时间归零，本次游玩先结束。调用 StartSession 后才继续计真实时间。
     */
    public Load(record: RealTimeRecord): void {
        if (!record) {
            throw new Error("缺少真实时间存档");
        }
        if (typeof record.totalRealTime !== "number" || !Number.isFinite(record.totalRealTime) || record.totalRealTime < 0) {
            throw new Error("累计真实游戏时间必须是非负有限数字");
        }
        this._totalRealTime = record.totalRealTime;
        this._sessionRealTime = 0;
        this._sessionActive = false;
    }
}

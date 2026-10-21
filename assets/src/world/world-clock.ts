import { TargetObserver } from "../framwork/observer/target-observer";
import { advanceGameSeconds, countGameUnitsCrossed, GameTimeUnit, gameTimeRemainder } from "../framwork/utils/date-utils";
import { setInstance } from "../framwork/utils/instance";
import { WorldConfig } from "./world-define";

/**
 * 需要持久化的世界时钟。
 * 只存累计游戏时间和当前倍速。真实游玩时间不在这里。
 * timeSpeed 是当前倍速，不是历史。历史时段的游戏时间已经加进 totalGameTime。
 */
export interface WorldClockRecord {
    /** 累计游戏时间，秒。世界按这个时间推进。 */
    totalGameTime: number;
    /** 存档时的用户倍速。读档后从这里继续，不会改写已经累计的游戏时间。 */
    timeSpeed: number;
}

/**
 * 世界时钟。只负责游戏时间。
 * 暂停或倍速为 0 时，游戏时间不动。真实时间由 RealTimeCounter 单独累计，本类不引用它。
 * 倍速改了以后只影响之后的 Tick，不回算以前的累计值。
 */
@setInstance
export class WorldClock extends TargetObserver {
    /** 累计游戏时间，秒。需要随存档保存，世界事件按它推进。 */
    private _totalGameTime: number = 0;
    /** 当前用户倍速。0 表示游戏时间停住。 */
    private _timeSpeed: number = WorldConfig.TimeSpeed;
    /** 世界是否在运行。暂停只停游戏时间。 */
    private _enableTick: boolean = false;

    /** 累计游戏时间，秒。 */
    public get TotalGameTime(): number {
        return this._totalGameTime;
    }

    /** 当前倍速。修改只影响之后的时间，不改累计游戏时间。 */
    public get TimeSpeed(): number {
        return this._timeSpeed;
    }

    public set TimeSpeed(value: number) {
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
            throw new Error("时间倍速必须是非负有限数字");
        }
        this._timeSpeed = value;
        WorldConfig.TimeSpeed = value;
    }

    public get EnableTick(): boolean {
        return this._enableTick;
    }

    /** 暂停或恢复世界。只控制游戏时间。 */
    public set EnableTick(value: boolean) {
        this._enableTick = value;
    }

    /**
     * 用一段真实秒数推进游戏时间。
     * 调用方在游戏暂停时不要调用，或者先把 EnableTick 设为 false。
     * 本方法不累计真实游玩时间。
     */
    public Tick(realSeconds: number): void {
        if (!this._enableTick) {
            return;
        }
        if (typeof realSeconds !== "number" || !Number.isFinite(realSeconds) || realSeconds < 0) {
            throw new Error("真实秒数必须是非负有限数字");
        }
        if (realSeconds === 0) {
            return;
        }
        const gameDelta = advanceGameSeconds(realSeconds, this._timeSpeed);
        if (gameDelta === 0) {
            return;
        }
        const beforeGameTime = this._totalGameTime;
        this._totalGameTime = beforeGameTime + gameDelta;
        this._emitCalendar(beforeGameTime, this._totalGameTime);
    }

    /** 导出需要持久化的游戏时间和当前倍速。 */
    public Save(): WorldClockRecord {
        return {
            totalGameTime: this._totalGameTime,
            timeSpeed: this._timeSpeed,
        };
    }

    /**
     * 读入存档。
     * 游戏时间先停住。读档不会补发中间越过的日、月、年事件。
     */
    public Load(record: WorldClockRecord): void {
        if (!record) {
            throw new Error("缺少时钟存档");
        }
        this._totalGameTime = this._readPlayTime(record.totalGameTime, "累计游戏时间");
        if (typeof record.timeSpeed !== "number" || !Number.isFinite(record.timeSpeed) || record.timeSpeed < 0) {
            throw new Error("存档里的时间倍速必须是非负有限数字");
        }
        this._timeSpeed = record.timeSpeed;
        WorldConfig.TimeSpeed = record.timeSpeed;
        this._enableTick = false;
    }

    public listen_min(remainder: number, crossed: number): void {
        void remainder;
        void crossed;
    }

    public listen_hour(remainder: number, crossed: number): void {
        void remainder;
        void crossed;
    }

    public listen_day(remainder: number, crossed: number): void {
        void remainder;
        void crossed;
    }

    public listen_month(remainder: number, crossed: number): void {
        void remainder;
        void crossed;
    }

    public listen_year(remainder: number, crossed: number): void {
        void remainder;
        void crossed;
    }

    /** 用累计游戏时间的前后位置判断越过了几段，避免大步长只扣一次上限。 */
    private _emitCalendar(beforeGameTime: number, afterGameTime: number): void {
        this._emitUnit(beforeGameTime, afterGameTime, GameTimeUnit.minute, this.listen_min);
        this._emitUnit(beforeGameTime, afterGameTime, GameTimeUnit.hour, this.listen_hour);
        this._emitUnit(beforeGameTime, afterGameTime, GameTimeUnit.day, this.listen_day);
        this._emitUnit(beforeGameTime, afterGameTime, GameTimeUnit.month, this.listen_month);
        this._emitUnit(beforeGameTime, afterGameTime, GameTimeUnit.year, this.listen_year);
    }

    private _emitUnit(
        beforeGameTime: number,
        afterGameTime: number,
        unit: number,
        callback: (remainder: number, crossed: number) => void
    ): void {
        const unitName = this._unitName(unit);
        const crossed = countGameUnitsCrossed(beforeGameTime, afterGameTime, unitName);
        if (crossed <= 0) {
            return;
        }
        callback(gameTimeRemainder(afterGameTime, unitName), crossed);
    }

    private _unitName(unit: number): "minute" | "hour" | "day" | "month" | "year" {
        switch (unit) {
            case GameTimeUnit.minute:
                return "minute";
            case GameTimeUnit.hour:
                return "hour";
            case GameTimeUnit.day:
                return "day";
            case GameTimeUnit.month:
                return "month";
            case GameTimeUnit.year:
                return "year";
            default:
                throw new Error("未知的游戏时间单位");
        }
    }

    private _readPlayTime(value: number, name: string): number {
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
            throw new Error(`${name}必须是非负有限数字`);
        }
        return value;
    }
}

import { TargetObserver } from "../framwork/observer/target-observer";
import { setInstance } from "../framwork/utils/instance";
import { WorldConfig } from "./world-define";

@setInstance
export class WorldClock extends TargetObserver {
    /** 运行游戏时间计时器 */
    private _counter: number = 0;
    /** 分钟计时器 */
    private _minCounter: number = 0;
    /** 小时计时器 */
    private _hourCounter: number = 0;
    /** 天计时器 */
    private _dayCounter: number = 0;
    /** 月计时器 */
    private _monthCounter: number = 0;
    /** 年计时器 */
    private _yearCounter: number = 0;

    /** 是否启用计时器，运行游戏时启用，暂停时禁用，运行游戏时间计时器不受影响 */
    private _enableTick: boolean = false;
    public set EnableTick(value: boolean) {
        this._enableTick = value;
    }
    public get EnableTick(): boolean {
        return this._enableTick;
    }

    public Tick(): void {
        const deltaTime = 1 * WorldConfig.TickRate;
        this._counter += deltaTime;
        if (!this._enableTick) return;
        this._minCounter = this._addTick(this._minCounter, deltaTime, 60, this.listen_min);
        this._hourCounter = this._addTick(this._hourCounter, deltaTime, 60 * 60, this.listen_hour);
        this._dayCounter = this._addTick(
            this._dayCounter,
            deltaTime,
            24 * 60 * 60,
            this.listen_day
        );
        this._monthCounter = this._addTick(
            this._monthCounter,
            deltaTime,
            30 * 24 * 60 * 60,
            this.listen_month
        );
        this._yearCounter = this._addTick(
            this._yearCounter,
            deltaTime,
            12 * 24 * 60 * 60,
            this.listen_year
        );
    }

    private _addTick(
        originValue: number,
        tick: number,
        limit: number,
        cb?: (newValue: number) => void
    ): number {
        let newValue = originValue + tick;
        if (newValue >= limit) {
            newValue = newValue - limit;
            cb?.(newValue);
        }
        return newValue;
    }

    public listen_min(tick: number) {}
    public listen_hour(tick: number) {}
    public listen_day(tick: number) {}
    public listen_month(tick: number) {}
    public listen_year(tick: number) {}
}

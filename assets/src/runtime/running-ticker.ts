import { director, ISchedulable } from "cc";
import { RealTimeCounter } from "../common/time/real-time-counter";
import { setInstance } from "../framwork/utils/instance";
import { WorldClock } from "../world/world-clock";
import { WorldDriver } from "../world/world-driver";

/** 每秒驱动一次。真实计时和世界推进都按这一秒结算。 */
const TICK_INTERVAL = 1;

/**
 * setInstance 导出的是单例对象，类型上仍是类。
 * 这里收成实例，避免调度器再 new 出一个时钟。
 */
const worldClock = WorldClock as unknown as WorldClock;
const worldDriver = WorldDriver as unknown as WorldDriver;

/**
 * 运行时每秒调度。
 * 真实计时和世界时钟互不引用，由这里每秒各调用一次 Tick(1)。
 * 游戏暂停只关掉世界时钟的 EnableTick，本调度继续走，真实时间仍然每秒加 1。
 */
@setInstance
export class RunningTicker implements ISchedulable {
    /** 调度器用来区分定时目标。 */
    public id: string = "everrealm-running-ticker";

    private _realTime: RealTimeCounter = new RealTimeCounter();
    /** 已经 start 过。resume 用来接着同一次游玩，而不是重新从 0 计。 */
    private _sessionStarted: boolean = false;
    /** 每秒回调是否挂在调度器上。 */
    private _running: boolean = false;

    /** 这一次游玩的真实计时。存档走它的 Save / Load。 */
    public get RealTime(): RealTimeCounter {
        return this._realTime;
    }

    private _onSecond = (): void => {
        this._realTime.Tick(TICK_INTERVAL);
        // 真实秒先换成目标游戏时间，再按任务和日切边界推进。暂停只看世界时钟的 EnableTick。
        worldDriver.advanceByRealSeconds(TICK_INTERVAL);
    };

    /** 开始新的一次游玩，并让世界时钟开始接收每秒推进。 */
    public start(): void {
        if (this._running) {
            return;
        }
        this._sessionStarted = true;
        this._realTime.StartSession();
        worldClock.EnableTick = true;
        this._schedule();
    }

    /** 卸下每秒回调，并停止真实计时。单次时间保留。世界是否暂停保持原样。 */
    public stop(): void {
        if (!this._running) {
            return;
        }
        this._unschedule();
        this._realTime.StopSession();
    }

    /**
     * 继续上一次游玩的每秒调度。
     * 单次真实时间不清零。世界如果已暂停，仍然只走真实计时。
     */
    public resume(): void {
        if (this._running) {
            return;
        }
        if (!this._sessionStarted) {
            this.start();
            return;
        }
        this._realTime.ResumeSession();
        this._schedule();
    }

    private _schedule(): void {
        director.getScheduler().schedule(this._onSecond, this, TICK_INTERVAL);
        this._running = true;
    }

    private _unschedule(): void {
        director.getScheduler().unschedule(this._onSecond, this);
        this._running = false;
    }
}

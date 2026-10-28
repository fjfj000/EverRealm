import { Instance, setInstance } from "../framwork/utils/instance";
import { advanceGameSeconds } from "../framwork/utils/date-utils";
import { TaskManager } from "../task/task-manager";
import { absoluteGameDay, nextDayBoundary } from "../task/schedule/game-time";
import { GameTime, TaskRecord } from "../task/task-contract";
import { WorldClock } from "./world-clock";

export type AdvanceStatus =
    | "completed"
    | "paused"
    | "yielded"
    | "awaitingExternalInput"
    | "faulted";

/**
 * 一次同步切片的预算。
 * 边界、执行条数和墙上时间用完后返回 yielded，下一帧再续。
 * 同一时刻的轮数和条数用完后返回 faulted，避免零延迟任务互相生成停不下来。
 */
export interface AdvanceBudget {
    /** 这一片最多跨越多少个绝对时间点。每次 moveTo 算一个。 */
    maxBoundariesPerSlice: number;
    /** 这一片最多把多少条到期任务送进执行管线。 */
    maxExecutionsPerSlice: number;
    /** 这一片最多占用多少毫秒墙上时间。 */
    maxMillisecondsPerSlice: number;
    /** 停在同一游戏秒时，最多循环多少轮。 */
    maxSameTimeRounds: number;
    /** 停在同一游戏秒时，最多执行多少条任务。 */
    maxSameTimeExecutions: number;
}

/** 一次 advanceSlice 或 advanceByRealSeconds 的结果。时间都是整数游戏秒。 */
export interface AdvanceResult {
    /** completed 走完；paused 等玩家；yielded 预算用完；awaitingExternalInput 等外部结果；faulted 无法继续。 */
    status: AdvanceStatus;
    /** 这次推进开始时的游戏时间。 */
    fromTime: GameTime;
    /** 这次推进停下时的游戏时间。暂停和失败都不会超过已经处理到的边界。 */
    toTime: GameTime;
    /** 调用方要求到达的游戏时间。暂停或让出时，它仍可能比 toTime 更晚。 */
    targetTime: GameTime;
    /** 这次实际拨钟的次数。 */
    processedBoundaries: number;
    /** 这次送进执行管线的到期任务条数。 */
    processedExecutions: number;
    /** 当前游戏秒上已经循环的轮数。时间往前走之后从 0 重新计。 */
    sameTimeRounds: number;
    /** 让世界停住的任务。只有 paused 或 awaitingExternalInput 时才有。 */
    pendingDecisionId?: string;
    /** faulted 的原因。其余状态不填。 */
    faultReason?: string;
}

export const DEFAULT_ADVANCE_BUDGET: AdvanceBudget = {
    maxBoundariesPerSlice: 10000,
    maxExecutionsPerSlice: 100000,
    maxMillisecondsPerSlice: 8,
    maxSameTimeRounds: 100,
    maxSameTimeExecutions: 10000,
};

/**
 * 在线和离线共用的时间推进器。
 * 只跳到下一个任务、日边界或目标时间，不等待业务 Promise。
 */
@setInstance
export class WorldDriver {
    private _realRemainder: number = 0;
    /** 上一次切片没走完的目标。下一次真实秒要加在它上面，不能从当前钟面重算。 */
    private _pendingTarget: number | null = null;
    /** 暂停或等待外部结果时，真实秒不再折成游戏时间。 */
    private _holdWorld: boolean = false;
    /** 玩家决定还没提交。下一次推进不能自己把暂停解开。 */
    private _decisionPaused: boolean = false;
    private _advancing: boolean = false;

    public resetRemainder(): void {
        this._realRemainder = 0;
        this._pendingTarget = null;
        this._holdWorld = false;
        this._decisionPaused = false;
    }

    /** 玩家提交了暂停期间的决定，下一次推进才可以离开这一秒。 */
    public resumeAfterDecision(): void {
        this._decisionPaused = false;
        this._holdWorld = false;
    }

    public exportProgress(): {
        remainder: number;
        pendingTarget: number | null;
        holdWorld: boolean;
        decisionPaused: boolean;
    } {
        return {
            remainder: this._realRemainder,
            pendingTarget: this._pendingTarget,
            holdWorld: this._holdWorld,
            decisionPaused: this._decisionPaused,
        };
    }

    public importProgress(progress: {
        remainder: number;
        pendingTarget: number | null;
        holdWorld: boolean;
        decisionPaused?: boolean;
    }): void {
        this._realRemainder = progress.remainder;
        this._pendingTarget = progress.pendingTarget;
        this._holdWorld = progress.holdWorld;
        this._decisionPaused = progress.decisionPaused ?? false;
    }

    /**
     * 预算用完就等下一帧再继续。
     * 这里只等待帧回调，不等待外部请求或玩家输入。
     */
    public async advanceFully(
        targetTime: GameTime,
        budget: AdvanceBudget,
        nextFrame: () => Promise<void>
    ): Promise<AdvanceResult> {
        let result = this.advanceSlice(targetTime, budget);
        while (result.status === "yielded") {
            await nextFrame();
            result = this.advanceSlice(result.targetTime, budget);
        }
        return result;
    }

    public advanceByRealSeconds(
        realSeconds: number,
        budget: AdvanceBudget = DEFAULT_ADVANCE_BUDGET
    ): AdvanceResult {
        const clock = Instance(WorldClock) as WorldClock;
        const fromTime = Math.floor(clock.TotalGameTime);
        if (!clock.EnableTick) {
            return this._result("completed", fromTime, fromTime, fromTime, 0, 0, 0);
        }
        let addedSeconds = 0;
        // 世界停着等待结果或玩家时，这段真实秒不推进游戏时间。
        if (!this._holdWorld && realSeconds > 0) {
            this._realRemainder += advanceGameSeconds(realSeconds, clock.TimeSpeed);
            addedSeconds = Math.floor(this._realRemainder);
            this._realRemainder -= addedSeconds;
        }
        const targetTime = (this._pendingTarget ?? fromTime) + addedSeconds;
        if (targetTime < fromTime) {
            throw new Error("游戏时间不能倒退");
        }
        if (targetTime === fromTime && !this._holdWorld) {
            return this._result("completed", fromTime, fromTime, targetTime, 0, 0, 0);
        }
        const result = this.advanceSlice(targetTime, budget);
        if (result.status === "faulted") {
            // 失败时保住这次目标，也不再折算新的真实秒，避免每秒把时间丢掉或越堆越高。
            this._holdWorld = true;
            this._pendingTarget = targetTime;
            return result;
        }
        this._holdWorld = result.status === "paused" || result.status === "awaitingExternalInput";
        // 让出或暂停时目标还在前面。丢掉它会让这一段游戏时间凭空消失。
        if (result.status === "yielded" || this._holdWorld) {
            this._pendingTarget = targetTime;
        } else {
            this._pendingTarget = null;
        }
        return result;
    }

    public advanceSlice(
        targetTime: GameTime,
        budget: AdvanceBudget = DEFAULT_ADVANCE_BUDGET
    ): AdvanceResult {
        if (this._advancing) {
            throw new Error("不能在任务推进过程中再次推进");
        }
        this._advancing = true;
        try {
            return this._advanceSlice(targetTime, budget);
        } finally {
            this._advancing = false;
        }
    }

    private _advanceSlice(targetTime: GameTime, budget: AdvanceBudget): AdvanceResult {
        if (!Number.isInteger(targetTime) || targetTime < 0) {
            console.error("目标游戏时间必须是非负整数秒", targetTime);
            return;
        }
        const clock = Instance(WorldClock) as WorldClock;
        const manager = Instance(TaskManager) as TaskManager;
        const fromTime = Math.floor(clock.TotalGameTime);
        if (targetTime < fromTime) {
            console.warn("游戏时间不能倒退", targetTime, fromTime);
            return;
        }
        let boundaries = 0;
        let executions = 0;
        let sameTimeRounds = 0;
        let sameTimeExecutions = 0;
        const triggerChain: string[] = [];
        const startedAt = Date.now();
        while (true) {
            const now = Math.floor(clock.TotalGameTime);
            if (this._decisionPaused) {
                return this._result(
                    "paused",
                    fromTime,
                    now,
                    targetTime,
                    boundaries,
                    executions,
                    sameTimeRounds,
                    manager.Pipeline.pauseTaskId
                );
            }
            manager.Pipeline.sweepTimeouts(now);
            // 安全点：先消化已经入队的外部结果，再决定能不能离开这一秒。
            manager.Pipeline.drainResults(now);
            if (manager.Pipeline.isBlocked) {
                return this._result(
                    "awaitingExternalInput",
                    fromTime,
                    now,
                    targetTime,
                    boundaries,
                    executions,
                    sameTimeRounds,
                    manager.Pipeline.pauseTaskId
                );
            }
            const due = [...manager.Pipeline.reclaim(now), ...manager.Schedule.drainDue(now)];
            if (due.length > 0) {
                sameTimeRounds += 1;
                triggerChain.push(due.map((task) => task.id).join(","));
                if (
                    sameTimeRounds > budget.maxSameTimeRounds ||
                    sameTimeExecutions + due.length > budget.maxSameTimeExecutions
                ) {
                    this._restore(manager, due, now);
                    return this._result(
                        "faulted",
                        fromTime,
                        now,
                        targetTime,
                        boundaries,
                        executions,
                        sameTimeRounds,
                        undefined,
                        `同一时刻循环未结束: ${triggerChain.join(" -> ")}`
                    );
                }
                const outcome = manager.Pipeline.submitDue(due, now);
                sameTimeExecutions += due.length;
                executions += due.length;
                this._restore(manager, manager.Pipeline.takeDeferred(), now);
                manager.Pipeline.drainResults(now);
                if (outcome === "faulted") {
                    return this._result(
                        "faulted",
                        fromTime,
                        now,
                        targetTime,
                        boundaries,
                        executions,
                        sameTimeRounds,
                        undefined,
                        manager.Pipeline.faultReason
                    );
                }
                if (manager.Pipeline.isBlocked) {
                    return this._result(
                        "awaitingExternalInput",
                        fromTime,
                        now,
                        targetTime,
                        boundaries,
                        executions,
                        sameTimeRounds,
                        manager.Pipeline.pauseTaskId
                    );
                }
                if (outcome === "paused") {
                    this._decisionPaused = true;
                    return this._result(
                        "paused",
                        fromTime,
                        now,
                        targetTime,
                        boundaries,
                        executions,
                        sameTimeRounds,
                        manager.Pipeline.pauseTaskId
                    );
                }
                continue;
            }
            if (now >= targetTime) {
                return this._result(
                    "completed",
                    fromTime,
                    now,
                    targetTime,
                    boundaries,
                    executions,
                    sameTimeRounds
                );
            }
            if (
                boundaries >= budget.maxBoundariesPerSlice ||
                executions >= budget.maxExecutionsPerSlice ||
                Date.now() - startedAt >= budget.maxMillisecondsPerSlice
            ) {
                return this._result(
                    "yielded",
                    fromTime,
                    now,
                    targetTime,
                    boundaries,
                    executions,
                    sameTimeRounds
                );
            }
            const nextTaskAt = manager.Schedule.peekNextSettleAt(now);
            const dayAt = nextDayBoundary(now);
            const boundary = Math.min(targetTime, nextTaskAt ?? Number.POSITIVE_INFINITY, dayAt);
            // 没有更晚的边界却还没到目标，说明索引里有个到不了的时间，不能空转。
            if (!Number.isFinite(boundary) || boundary <= now) {
                return this._result(
                    "faulted",
                    fromTime,
                    now,
                    targetTime,
                    boundaries,
                    executions,
                    sameTimeRounds,
                    undefined,
                    "边界没有前进"
                );
            }
            clock.moveTo(boundary);
            boundaries += 1;
            if (boundary === dayAt) {
                manager.Schedule.promoteDay(absoluteGameDay(boundary));
            }
            sameTimeRounds = 0;
            sameTimeExecutions = 0;
        }
    }

    private _restore(manager: TaskManager, tasks: readonly TaskRecord[], now: GameTime): void {
        for (const task of tasks) {
            manager.Schedule.schedule(task, now);
        }
    }

    private _result(
        status: AdvanceStatus,
        fromTime: GameTime,
        toTime: GameTime,
        targetTime: GameTime,
        processedBoundaries: number,
        processedExecutions: number,
        sameTimeRounds: number,
        pendingDecisionId?: string,
        faultReason?: string
    ): AdvanceResult {
        return {
            status,
            fromTime,
            toTime,
            targetTime,
            processedBoundaries,
            processedExecutions,
            sameTimeRounds,
            pendingDecisionId,
            faultReason,
        };
    }
}

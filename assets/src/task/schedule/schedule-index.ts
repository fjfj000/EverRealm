import { GameTime, TaskRecord } from "../task-contract";
import { isTerminalLifecycle } from "../task-define";
import { FutureDayTable, indexTime } from "./future-day-table";
import { absoluteGameDay, minuteOfDay, FUTURE_DAY_WINDOW } from "./game-time";
import { OverflowIndex } from "./overflow-index";
import { compareTaskRecord } from "./task-order";
import { TodayMinuteTable } from "./today-minute-table";

/**
 * 由任务记录重建的时间索引。
 * 今日分钟表只放当天任务，未来日表放今天起五年内的后续日期，再往后的放 overflow。
 */
export class ScheduleIndex {
    private readonly _futureDays = new FutureDayTable();
    private readonly _todayMinutes = new TodayMinuteTable();
    private readonly _overflow = new OverflowIndex();
    private _today: number = 0;
    /** 插入时的槽位。之后即使改了 nextSettleAt，也能从原槽摘掉。 */
    private readonly _placement = new Map<
        TaskRecord,
        { table: "today" | "future" | "overflow"; unit: number }
    >();

    /**
     * 新登记插入。
     * 终态不入表。结算时刻已经过去也不入表，并且不改生命周期，迟到策略由登记方决定。
     * 等于当前时间仍然插入，这一轮 drainDue 会把它取走。
     */
    public schedule(task: TaskRecord, now: GameTime): boolean {
        this._detach(task);
        this._roll(absoluteGameDay(now));
        if (isTerminalLifecycle(task.lifecycleState) || now > task.nextSettleAt) {
            return false;
        }
        this._place(task, now);
        return true;
    }

    /**
     * 放回已经接纳、尚未结束的任务。
     * 暂停、故障和读档重建走这里。结算时刻早于当前时间也保留，不在这里改生命周期。
     */
    public restore(task: TaskRecord, now: GameTime): void {
        this._detach(task);
        this._roll(absoluteGameDay(now));
        if (isTerminalLifecycle(task.lifecycleState)) {
            return;
        }
        this._place(task, now);
    }

    private _place(task: TaskRecord, now: GameTime): void {
        const day = absoluteGameDay(indexTime(task));
        if (day === absoluteGameDay(now)) {
            const minute = minuteOfDay(indexTime(task));
            this._todayMinutes.scheduleAt(minute, task);
            this._placement.set(task, { table: "today", unit: minute });
            return;
        }
        if (this._futureDays.accepts(task)) {
            this._futureDays.schedule(task);
            this._placement.set(task, { table: "future", unit: day });
            return;
        }
        this._overflow.schedule(task);
        this._placement.set(task, { table: "overflow", unit: day });
    }

    public remove(task: TaskRecord): boolean {
        return this._detach(task);
    }

    private _detach(task: TaskRecord): boolean {
        const placed = this._placement.get(task);
        this._placement.delete(task);
        if (!placed) {
            return (
                this._todayMinutes.remove(task) ||
                this._futureDays.remove(task) ||
                this._overflow.remove(task)
            );
        }
        if (placed.table === "today") {
            return this._todayMinutes.removeAt(placed.unit, task);
        }
        if (placed.table === "future") {
            return this._futureDays.removeOnDay(placed.unit, task);
        }
        return this._overflow.remove(task);
    }

    private _rememberToday(task: TaskRecord): void {
        this._placement.delete(task);
        const minute = minuteOfDay(indexTime(task));
        this._todayMinutes.scheduleAt(minute, task);
        this._placement.set(task, { table: "today", unit: minute });
    }

    public peekNextSettleAt(now: GameTime): GameTime | undefined {
        const candidates = [
            this._todayMinutes.peekNextSettleAt(now),
            this._futureDays.peekNextSettleAt(now),
            this._overflow.peekNextSettleAt(now),
        ].filter((time): time is number => time !== undefined);
        if (candidates.length === 0) {
            return undefined;
        }
        return Math.min(...candidates);
    }

    /** 当前时刻已经到期的任务，包含迟到仍留在索引里的记录。 */
    public drainDue(now: GameTime): TaskRecord[] {
        const due = [
            ...this._todayMinutes.drainDue(now),
            ...this._futureDays.drainDue(now),
            ...this._overflow.drainDue(now),
        ].sort(compareTaskRecord);
        for (const task of due) {
            this._placement.delete(task);
        }
        return due;
    }

    public drainAt(settleAt: GameTime): TaskRecord[] {
        return [...this._todayMinutes.drainAt(settleAt), ...this._overflow.drainAt(settleAt)].sort(
            compareTaskRecord
        );
    }

    public clear(): void {
        this._todayMinutes.clear();
        this._futureDays.clear();
        this._overflow.clear();
        this._placement.clear();
        this._today = 0;
    }

    /** 到达新的一天时，滚动未来窗口，再把这一天的任务升到今日分钟表。 */
    public promoteDay(absoluteDay: number): void {
        this._today = absoluteDay;
        this._roll(absoluteDay);
        const incoming = [
            ...this._futureDays.drainDay(absoluteDay),
            ...this._overflow.drainDay(absoluteDay),
        ];
        for (const task of incoming) {
            this._rememberToday(task);
        }
    }

    public locate(task: TaskRecord): "today" | "future" | "overflow" | "missing" {
        if (this._todayMinutes.contains(task)) {
            return "today";
        }
        if (this._futureDays.contains(task)) {
            return "future";
        }
        if (this._overflow.contains(task)) {
            return "overflow";
        }
        return "missing";
    }

    public rebuild(tasks: readonly TaskRecord[], now: GameTime): void {
        this.clear();
        const today = absoluteGameDay(now);
        this._today = today;
        this._futureDays.retarget(today);
        for (const task of tasks) {
            this.restore(task, now);
        }
    }

    /**
     * 未来窗口的左端必须是今天，覆盖其后五年。
     * 今天没变时不搬动。今天前进后，左边滑出的日子进入 overflow，右边新进入五年的日子迁回未来表。
     */
    private _roll(today: number): void {
        if (today === this._futureDays.epoch) {
            return;
        }
        for (const task of this._futureDays.retarget(today)) {
            const day = absoluteGameDay(indexTime(task));
            this._overflow.schedule(task);
            this._placement.set(task, { table: "overflow", unit: day });
        }
        const migrated = this._overflow.drainWindow(today);
        for (const task of migrated) {
            const day = absoluteGameDay(indexTime(task));
            if (day === today) {
                this._rememberToday(task);
                continue;
            }
            if (day >= today && day < today + FUTURE_DAY_WINDOW) {
                this._futureDays.schedule(task);
                this._placement.set(task, { table: "future", unit: day });
                continue;
            }
            this._overflow.schedule(task);
            this._placement.set(task, { table: "overflow", unit: day });
        }
    }
}

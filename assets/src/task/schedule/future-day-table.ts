import { DirectAddressTable } from "../../framwork/data_structures/direct-address-table";
import { TaskRecord } from "../task-contract";
import { absoluteGameDay, FUTURE_DAY_WINDOW } from "./game-time";
import { compareTaskRecord } from "./task-order";

/**
 * 非今日任务按游戏日分槽。
 * 槽位是「绝对日 - epoch」，窗口跟着今天往前滚。窗口外交给 OverflowIndex。
 */
export class FutureDayTable {
    private readonly _table = new DirectAddressTable<TaskRecord>(0, FUTURE_DAY_WINDOW - 1, compareTaskRecord);
    private _epoch: number = 0;

    public get epoch(): number {
        return this._epoch;
    }

    public accepts(task: TaskRecord): boolean {
        return this._containsDay(absoluteGameDay(indexTime(task)));
    }

    public schedule(task: TaskRecord): void {
        this.scheduleOnDay(absoluteGameDay(indexTime(task)), task);
    }

    public scheduleOnDay(day: number, task: TaskRecord): void {
        if (!this._containsDay(day)) {
            throw new Error("任务日不在未来窗口内");
        }
        this._table.insert(day - this._epoch, task);
    }

    public remove(task: TaskRecord): boolean {
        return this.removeOnDay(absoluteGameDay(indexTime(task)), task);
    }

    public removeOnDay(day: number, task: TaskRecord): boolean {
        if (!this._containsDay(day)) {
            return false;
        }
        return this._table.remove(day - this._epoch, task);
    }

    public clear(): void {
        this._table.clear();
        this._epoch = 0;
    }

    /**
     * 把窗口起点拨到今天。
     * 还落在新窗口里的任务留在表内，滑出窗口的交还给调用方。
     */
    public retarget(epoch: number): TaskRecord[] {
        if (epoch === this._epoch) {
            return [];
        }
        const carried: TaskRecord[] = [];
        for (const task of this._table) {
            carried.push(task);
        }
        this._table.clear();
        this._epoch = epoch;
        const displaced: TaskRecord[] = [];
        for (const task of carried) {
            if (this.accepts(task)) {
                this.schedule(task);
            } else {
                displaced.push(task);
            }
        }
        return displaced;
    }

    public drainDue(now: number): TaskRecord[] {
        const found: TaskRecord[] = [];
        const today = absoluteGameDay(now);
        for (const task of this._table) {
            if (absoluteGameDay(indexTime(task)) > today) {
                break;
            }
            if (isDue(task, now)) {
                found.push(task);
            }
        }
        for (const task of found) {
            this.remove(task);
        }
        return found;
    }

    public peekNextSettleAt(now: number): number | undefined {
        let best: number | undefined;
        let bestDay: number | undefined;
        for (const task of this._table) {
            const day = absoluteGameDay(indexTime(task));
            // 下一天的时间不会早于这一天里已经看到的边界。
            if (bestDay !== undefined && day > bestDay) {
                break;
            }
            const due = earlierDue(task, now);
            if (due === undefined) {
                continue;
            }
            if (best === undefined || due < best) {
                best = due;
                bestDay = day;
            }
        }
        return best;
    }

    public drainDay(absoluteDay: number): TaskRecord[] {
        if (!this._containsDay(absoluteDay)) {
            return [];
        }
        const found = this._table.readUnit(absoluteDay - this._epoch).slice();
        for (const task of found) {
            this.removeOnDay(absoluteDay, task);
        }
        return found;
    }

    public contains(task: TaskRecord): boolean {
        for (const stored of this._table) {
            if (stored === task) {
                return true;
            }
        }
        return false;
    }

    private _containsDay(day: number): boolean {
        return day >= this._epoch && day < this._epoch + FUTURE_DAY_WINDOW;
    }
}

/** 索引用的时间。activeUntil 更早时，任务要放在那个更早的槽里才能被取到。 */
export function indexTime(task: TaskRecord): number {
    if (task.activeUntil !== undefined && task.activeUntil < task.nextSettleAt) {
        return task.activeUntil;
    }
    return task.nextSettleAt;
}

export function isDue(task: TaskRecord, now: number): boolean {
    if (task.nextSettleAt <= now) {
        return true;
    }
    return task.activeUntil !== undefined && task.activeUntil <= now && task.activeUntil < task.nextSettleAt;
}

export function earlierDue(task: TaskRecord, now: number): number | undefined {
    let best: number | undefined;
    if (task.nextSettleAt >= now) {
        best = task.nextSettleAt;
    }
    if (task.activeUntil !== undefined && task.activeUntil >= now && task.activeUntil < task.nextSettleAt) {
        if (best === undefined || task.activeUntil < best) {
            best = task.activeUntil;
        }
    }
    return best;
}

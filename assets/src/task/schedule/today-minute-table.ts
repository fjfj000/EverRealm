import { DirectAddressTable } from "../../framwork/data_structures/direct-address-table";
import { GameTimeUnit } from "../../framwork/utils/date-utils";
import { TaskRecord } from "../task-contract";
import { indexTime, isDue } from "./future-day-table";
import { minuteOfDay } from "./game-time";
import { compareTaskRecord } from "./task-order";

const LAST_MINUTE_OF_DAY = GameTimeUnit.day / GameTimeUnit.minute - 1;

/**
 * 今日任务按日内分钟分槽。
 * 查询从当前分钟的槽开始，不每次从 0 点重扫。
 */
export class TodayMinuteTable {
    private readonly _table = new DirectAddressTable<TaskRecord>(0, LAST_MINUTE_OF_DAY, compareTaskRecord);
    private _scanCursor: number = 0;

    public schedule(task: TaskRecord): void {
        this.scheduleAt(minuteOfDay(indexTime(task)), task);
    }

    public scheduleAt(minute: number, task: TaskRecord): void {
        this._table.insert(minute, task);
        if (minute < this._scanCursor) {
            this._scanCursor = minute;
        }
    }

    public remove(task: TaskRecord): boolean {
        return this.removeAt(minuteOfDay(indexTime(task)), task);
    }

    public removeAt(minute: number, task: TaskRecord): boolean {
        return this._table.remove(minute, task);
    }

    public contains(task: TaskRecord): boolean {
        for (const stored of this._table) {
            if (stored === task) {
                return true;
            }
        }
        return false;
    }

    public clear(): void {
        this._table.clear();
        this._scanCursor = 0;
    }

    public peekNextSettleAt(now: number): number | undefined {
        const scheduled = this._peekScheduled(now);
        const partial = this._earlierActiveUntil(now);
        if (scheduled === undefined) {
            return partial;
        }
        if (partial === undefined) {
            return scheduled;
        }
        return Math.min(scheduled, partial);
    }

    private _peekScheduled(now: number): number | undefined {
        let slot = Math.max(this._scanCursor, minuteOfDay(now));
        while (slot <= LAST_MINUTE_OF_DAY) {
            const found = this._table.readNextFromSlot(slot);
            if (!found) {
                return undefined;
            }
            this._scanCursor = found.slot;
            if (found.value.nextSettleAt >= now) {
                return found.value.nextSettleAt;
            }
            // 同一分钟里可能还有更晚的任务，不能直接跳到下一槽。
            const later = this._laterInSlot(found.slot, now);
            if (later !== undefined) {
                return later;
            }
            slot = found.slot + 1;
            this._scanCursor = slot;
        }
        return undefined;
    }

    /** 槽位按 nextSettleAt 放置。activeUntil 更早时不能只靠游标，要再看一遍。 */
    private _earlierActiveUntil(now: number): number | undefined {
        let best: number | undefined;
        for (const task of this._table) {
            if (task.activeUntil === undefined || task.activeUntil < now || task.activeUntil >= task.nextSettleAt) {
                continue;
            }
            if (best === undefined || task.activeUntil < best) {
                best = task.activeUntil;
            }
        }
        return best;
    }

    /** 取出不超过 now 的任务。调用方先收齐再删，避免边遍历边移除漏掉后续项。 */
    public drainDue(now: number): TaskRecord[] {
        const lastMinute = minuteOfDay(now);
        const found: TaskRecord[] = [];
        // 只扫到当前分钟。更晚的分钟槽里没有已经到期的任务。
        for (let minute = 0; minute <= lastMinute; minute += 1) {
            for (const task of this._table.readUnit(minute)) {
                if (isDue(task, now)) {
                    found.push(task);
                }
            }
        }
        for (const task of found) {
            this.removeAt(minuteOfDay(indexTime(task)), task);
        }
        this._scanCursor = lastMinute;
        return found;
    }

    public drainAt(settleAt: number): TaskRecord[] {
        const minute = minuteOfDay(settleAt);
        const found = this._table.readUnit(minute).filter((task) => task.nextSettleAt === settleAt);
        for (const task of found) {
            this.removeAt(minuteOfDay(indexTime(task)), task);
        }
        return found;
    }

    /** 槽头已经早于 now 时，继续看这个分钟槽里的后续任务。 */
    private _laterInSlot(slot: number, now: number): number | undefined {
        for (const task of this._table) {
            if (minuteOfDay(task.nextSettleAt) < slot) {
                continue;
            }
            if (minuteOfDay(task.nextSettleAt) > slot) {
                return undefined;
            }
            if (task.nextSettleAt >= now) {
                return task.nextSettleAt;
            }
        }
        return undefined;
    }
}

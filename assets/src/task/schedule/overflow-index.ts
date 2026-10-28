import { GameTime, TaskRecord } from "../task-contract";
import { absoluteGameDay, FUTURE_DAY_WINDOW } from "./game-time";
import { earlierDue, indexTime, isDue } from "./future-day-table";
import { compareTaskRecord } from "./task-order";

/** 固定日窗口之外的任务。进入窗口时再迁回直址表。 */
export class OverflowIndex {
    private _tasks: TaskRecord[] = [];
    private _dirty: boolean = false;

    public schedule(task: TaskRecord): void {
        this._tasks.push(task);
        this._dirty = true;
    }

    private _ensureSorted(): void {
        if (!this._dirty) {
            return;
        }
        this._tasks.sort(compareTaskRecord);
        this._dirty = false;
    }

    public clear(): void {
        this._tasks = [];
        this._dirty = false;
    }

    public remove(task: TaskRecord): boolean {
        const index = this._tasks.indexOf(task);
        if (index < 0) {
            return false;
        }
        this._tasks.splice(index, 1);
        return true;
    }

    public peekNextSettleAt(now: GameTime): GameTime | undefined {
        this._ensureSorted();
        let best: GameTime | undefined;
        for (const task of this._tasks) {
            const due = earlierDue(task, now);
            if (due === undefined) {
                continue;
            }
            if (best === undefined || due < best) {
                best = due;
            }
        }
        return best;
    }

    /** 取出已经落入 [epoch, epoch + 窗口) 的任务，供滚动后迁回直址表。 */
    public drainWindow(epoch: number): TaskRecord[] {
        this._ensureSorted();
        const end = epoch + FUTURE_DAY_WINDOW;
        const found = this._tasks.filter((task) => {
            const day = absoluteGameDay(indexTime(task));
            return day >= epoch && day < end;
        });
        const moving = new Set(found);
        this._tasks = this._tasks.filter((task) => !moving.has(task));
        return found;
    }

    public drainDay(absoluteDay: number): TaskRecord[] {
        this._ensureSorted();
        const found = this._tasks.filter((task) => absoluteGameDay(indexTime(task)) === absoluteDay);
        this._tasks = this._tasks.filter((task) => absoluteGameDay(indexTime(task)) !== absoluteDay);
        return found;
    }

    public contains(task: TaskRecord): boolean {
        return this._tasks.indexOf(task) >= 0;
    }

    public drainDue(now: GameTime): TaskRecord[] {
        this._ensureSorted();
        const found = this._tasks.filter((task) => isDue(task, now));
        const dropping = new Set(found);
        this._tasks = this._tasks.filter((task) => !dropping.has(task));
        return found;
    }

    public drainAt(settleAt: GameTime): TaskRecord[] {
        const found = this._tasks.filter((task) => task.nextSettleAt === settleAt);
        this._tasks = this._tasks.filter((task) => task.nextSettleAt !== settleAt);
        return found;
    }
}

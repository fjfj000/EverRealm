import { TaskRecord } from "../task-contract";
import { compareTaskRecord } from "../schedule/task-order";

/**
 * 已经到期的任务按优先级和序号尝试启动。
 * 队头因资源或依赖受阻时，继续找后面能跑的任务。
 */
export class ReadyScheduler {
    private _pending: TaskRecord[] = [];

    public get size(): number {
        return this._pending.length;
    }

    public clear(): void {
        this._pending = [];
    }

    public enqueue(tasks: readonly TaskRecord[]): void {
        this._pending.push(...tasks);
        this._pending.sort(compareTaskRecord);
    }

    public tasks(): readonly TaskRecord[] {
        return this._pending;
    }

    /** 跳过不能跑的队头，返回后面第一个满足条件的位置。 */
    public indexOf(canRun: (task: TaskRecord) => boolean): number {
        return this._pending.findIndex(canRun);
    }

    public removeAt(index: number): TaskRecord {
        const task = this._pending[index];
        this._pending.splice(index, 1);
        return task;
    }

    public drain(): TaskRecord[] {
        const tasks = this._pending;
        this._pending = [];
        return tasks;
    }
}

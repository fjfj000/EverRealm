import { GameTime, TaskChangeSet, TaskRecord } from "../task-contract";

export type TaskHandler = (task: TaskRecord, now: GameTime) => TaskChangeSet | void;

/** 运行期处理器和序号。不放进可存档的 TaskRecord。 */
export class TaskRuntime {
    private readonly _handlers: Map<string, TaskHandler> = new Map();
    private _sequence: number = 1;

    public nextSequence(): number {
        const sequence = this._sequence;
        this._sequence += 1;
        return sequence;
    }

    public peekSequence(): number {
        return this._sequence;
    }

    public restoreSequence(value: number): void {
        if (!Number.isInteger(value) || value < 1) {
            throw new Error("任务序号必须是正整数");
        }
        this._sequence = value;
    }

    public setHandler(taskId: string, handler: TaskHandler): void {
        this._handlers.set(taskId, handler);
    }

    public handler(taskId: string): TaskHandler | undefined {
        return this._handlers.get(taskId);
    }

    public remove(taskId: string): void {
        this._handlers.delete(taskId);
    }

    public clear(): void {
        this._handlers.clear();
        this._sequence = 1;
    }
}

import { TaskRecord } from "../task-contract";

/** 任务主存储。直址表和堆只是索引，不能代替这里的记录。 */
export class TaskRepository {
    private readonly _tasks: Map<string, TaskRecord> = new Map();

    public add(task: TaskRecord): void {
        this._tasks.set(task.id, task);
    }

    public get(taskId: string): TaskRecord | undefined {
        return this._tasks.get(taskId);
    }

    public remove(taskId: string): boolean {
        return this._tasks.delete(taskId);
    }

    public list(): TaskRecord[] {
        return Array.from(this._tasks.values());
    }

    public clear(): void {
        this._tasks.clear();
    }
}

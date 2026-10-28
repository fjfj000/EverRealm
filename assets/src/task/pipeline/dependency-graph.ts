import { ExecutionRecord, TaskRecord } from "../task-contract";

/** 显式依赖。依赖没完成时请求不能启动，完成后由调度器再次尝试。 */
export class DependencyGraph {
    private readonly _finished: Set<string> = new Set();

    public isRunnable(task: TaskRecord): boolean {
        return task.dependsOn.every((executionId) => this._finished.has(executionId));
    }

    public notifyFinished(execution: ExecutionRecord): void {
        this._finished.add(execution.executionId);
    }

    public clear(): void {
        this._finished.clear();
    }
}

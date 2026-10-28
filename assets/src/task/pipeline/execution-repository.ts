import { ExecutionRecord, TaskExecutionRequest } from "../task-contract";

/** 每一次触发的主记录。一个 Task 可以同时有多条 execution。 */
export class ExecutionRepository {
    private readonly _executions: Map<string, ExecutionRecord> = new Map();

    public add(request: TaskExecutionRequest): void {
        this._executions.set(request.execution.executionId, request.execution);
    }

    public get(executionId: string): ExecutionRecord | undefined {
        return this._executions.get(executionId);
    }

    public remove(executionId: string): boolean {
        return this._executions.delete(executionId);
    }

    public list(): ExecutionRecord[] {
        return Array.from(this._executions.values());
    }

    public clear(): void {
        this._executions.clear();
    }
}

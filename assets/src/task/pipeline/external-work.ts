import { ExecutionRecord, TaskRecord } from "../task-contract";
import type { TaskPipeline } from "./task-pipeline";

interface PendingWork {
    correlationId: string;
    executionId: string;
    taskId: string;
    taskRevision: number;
    idempotencyKey: string;
}

/**
 * 外部请求的句柄。
 * complete / fail / abort 只把结果放进收件箱，不改世界，也不推进时钟。
 */
export class ExternalWork {
    private readonly _pending: Map<string, PendingWork> = new Map();

    public constructor(private readonly _pipeline: TaskPipeline) {}

    public issue(task: TaskRecord, execution: ExecutionRecord): string {
        const correlationId = `ext:${execution.executionId}:${execution.attempt}`;
        execution.externalCorrelationId = correlationId;
        this._pending.set(correlationId, {
            correlationId,
            executionId: execution.executionId,
            taskId: task.id,
            taskRevision: task.revision,
            idempotencyKey: execution.idempotencyKey,
        });
        return correlationId;
    }

    public complete(correlationId: string, payload?: unknown): void {
        const pending = this._take(correlationId);
        if (!pending) {
            return;
        }
        this._pipeline.acceptExternalResult({
            executionId: pending.executionId,
            taskId: pending.taskId,
            taskRevision: pending.taskRevision,
            success: true,
            payload,
            idempotencyKey: pending.idempotencyKey,
            externalCorrelationId: correlationId,
        });
    }

    public fail(correlationId: string, errorCode: string): void {
        const pending = this._take(correlationId);
        if (!pending) {
            return;
        }
        this._pipeline.acceptExternalResult({
            executionId: pending.executionId,
            taskId: pending.taskId,
            taskRevision: pending.taskRevision,
            success: false,
            errorCode,
            idempotencyKey: pending.idempotencyKey,
            externalCorrelationId: correlationId,
        });
    }

    public abort(correlationId: string): void {
        const pending = this._pending.get(correlationId);
        if (!pending) {
            return;
        }
        this._pending.delete(correlationId);
        this._pipeline.cancelTask(pending.taskId);
    }

    public pendingIds(): string[] {
        return Array.from(this._pending.keys());
    }

    public clear(): void {
        this._pending.clear();
    }

    private _take(correlationId: string): PendingWork | undefined {
        const pending = this._pending.get(correlationId);
        if (!pending) {
            return undefined;
        }
        this._pending.delete(correlationId);
        return pending;
    }
}

import { TaskChangeSet, TaskExecutionRequest, ExecutionRecord } from "../task-contract";
import { TaskHandler } from "./task-runtime";

export interface PendingExecution {
    executionId: string;
    externalCorrelationId?: string;
    idempotencyKey: string;
}

/**
 * 调用业务 handler。
 * 同步任务返回 ChangeSet。异步任务只登记等待，不等待 Promise。
 */
export class TaskExecutor {
    public executeSync(request: TaskExecutionRequest, handler: TaskHandler | undefined, now: number): TaskChangeSet {
        const produced = handler ? handler(request.task, now) : undefined;
        const changeSet = isChangeSet(produced) ? produced : undefined;
        return {
            executionId: request.execution.executionId,
            readSet: changeSet?.readSet ?? {},
            commands: changeSet?.commands ?? [],
            idempotencyKey: request.execution.idempotencyKey,
        };
    }

    /** 只登记等待。真正的外部调用由调用方持有，这里不接收 Promise。 */
    public startAsync(request: TaskExecutionRequest): PendingExecution {
        return {
            executionId: request.execution.executionId,
            idempotencyKey: request.execution.idempotencyKey,
        };
    }

    public prepareResult(execution: ExecutionRecord, payload: unknown): TaskChangeSet {
        const changeSet = isChangeSet(payload as TaskChangeSet | void) ? (payload as TaskChangeSet) : undefined;
        return {
            executionId: execution.executionId,
            readSet: changeSet?.readSet ?? {},
            commands: changeSet?.commands ?? [],
            idempotencyKey: execution.idempotencyKey,
        };
    }
}

function isChangeSet(value: TaskChangeSet | void): value is TaskChangeSet {
    return !!value && typeof value === "object";
}

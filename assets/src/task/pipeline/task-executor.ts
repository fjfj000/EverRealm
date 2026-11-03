import { TaskChangeSet, TaskExecutionRequest, ExecutionRecord } from "../task-contract";
import { TaskHandler } from "./task-runtime";

export interface PendingExecution {
    executionId: string;
    externalCorrelationId?: string;
    idempotencyKey: string;
}

/**
 * 调用业务 handler，并把结果收成带执行身份的 TaskChangeSet。
 * 同步和异步的调用入口不同，编号和幂等键都以这次执行自己的为准。
 */
export class TaskExecutor {
    public executeSync(request: TaskExecutionRequest, handler: TaskHandler | undefined, now: number): TaskChangeSet {
        const produced = handler ? handler(request.task, now) : undefined;
        return this.normalize(request.execution, produced);
    }

    /**
     * 调用异步处理函数。
     * 返回值不是提交结果，变更以后从外部载荷规范化。
     */
    public invokeAsync(request: TaskExecutionRequest, handler: TaskHandler | undefined, now: number): void {
        if (handler) {
            handler(request.task, now);
        }
    }

    /** 只登记等待。真正的外部调用由调用方持有，这里不接收 Promise。 */
    public startAsync(request: TaskExecutionRequest): PendingExecution {
        return {
            executionId: request.execution.executionId,
            externalCorrelationId: request.execution.externalCorrelationId,
            idempotencyKey: request.execution.idempotencyKey,
        };
    }

    /**
     * 把外部载荷收成变更。
     * 没有载荷时是空变更。有载荷但既没有读集也没有命令时返回 undefined，调用方应让执行失败。
     */
    public prepareResult(execution: ExecutionRecord, payload: unknown): TaskChangeSet | undefined {
        if (payload === undefined || payload === null) {
            return this.normalize(execution, undefined);
        }
        if (!isChangeSet(payload)) {
            return undefined;
        }
        return this.normalize(execution, payload);
    }

    /** 载荷里自带的执行编号和幂等键不能替换这次执行的身份。 */
    public normalize(execution: ExecutionRecord, produced: unknown): TaskChangeSet {
        const changeSet = isChangeSet(produced) ? produced : undefined;
        return {
            executionId: execution.executionId,
            readSet: changeSet?.readSet ?? {},
            commands: changeSet?.commands ?? [],
            idempotencyKey: execution.idempotencyKey,
        };
    }
}

function isChangeSet(value: unknown): value is TaskChangeSet {
    if (!value || typeof value !== "object") {
        return false;
    }
    const record = value as { readSet?: unknown; commands?: unknown };
    return Array.isArray(record.commands) || (!!record.readSet && typeof record.readSet === "object");
}

import { ExecutionRecord } from "../task-contract";
import { TaskExecutionStatus } from "../task-define";

/**
 * 同步和异步共用的执行状态图。
 * 准备和提交只出现在真正写入之前；终态不能再转走。
 */
export function transitionExecution(execution: ExecutionRecord, next: TaskExecutionStatus): void {
    if (!canTransitionExecution(execution.status, next)) {
        throw new Error(`执行状态不能从 ${execution.status} 转到 ${next}`);
    }
    execution.status = next;
}

function canTransitionExecution(from: TaskExecutionStatus, to: TaskExecutionStatus): boolean {
    switch (from) {
        case TaskExecutionStatus.Ready:
            return (
                to === TaskExecutionStatus.Running ||
                to === TaskExecutionStatus.Canceled ||
                to === TaskExecutionStatus.Expired ||
                to === TaskExecutionStatus.Skipped
            );
        case TaskExecutionStatus.Running:
            return (
                to === TaskExecutionStatus.Waiting ||
                to === TaskExecutionStatus.Prepared ||
                to === TaskExecutionStatus.Failed ||
                to === TaskExecutionStatus.Canceled ||
                to === TaskExecutionStatus.Expired ||
                to === TaskExecutionStatus.Skipped
            );
        case TaskExecutionStatus.Waiting:
            return (
                to === TaskExecutionStatus.Prepared ||
                to === TaskExecutionStatus.Completed ||
                to === TaskExecutionStatus.Failed ||
                to === TaskExecutionStatus.Canceled ||
                to === TaskExecutionStatus.Expired
            );
        case TaskExecutionStatus.Prepared:
            return (
                to === TaskExecutionStatus.Committing ||
                to === TaskExecutionStatus.Completed ||
                to === TaskExecutionStatus.Failed ||
                to === TaskExecutionStatus.Canceled ||
                to === TaskExecutionStatus.Expired
            );
        case TaskExecutionStatus.Committing:
            return (
                to === TaskExecutionStatus.Completed ||
                to === TaskExecutionStatus.Failed ||
                to === TaskExecutionStatus.Canceled ||
                to === TaskExecutionStatus.Expired
            );
        case TaskExecutionStatus.Completed:
        case TaskExecutionStatus.Failed:
        case TaskExecutionStatus.Canceled:
        case TaskExecutionStatus.Expired:
        case TaskExecutionStatus.Skipped:
            return false;
        default: {
            const neverStatus: never = from;
            void neverStatus;
            return false;
        }
    }
}

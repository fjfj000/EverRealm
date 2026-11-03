import { ExecutionRecord, TaskRecord } from "../task-contract";
import { TaskExecutionStatus, TaskLifecycleState, isTerminalLifecycle } from "../task-define";
import { DependencyGraph } from "./dependency-graph";
import { transitionExecution } from "./execution-status";
import { ResourceArbiter } from "./resource-arbiter";

export type FinishOutcome = "completed" | "expired" | "failed";

/**
 * 同步任务结束后更新生命周期。
 * 失败和过期也走这里，避免资源停在占用状态。
 */
export class TaskFinalizer {
    public finish(
        task: TaskRecord,
        execution: ExecutionRecord,
        outcome: FinishOutcome,
        resources: ResourceArbiter,
        dependencies: DependencyGraph,
        keepTaskOpen: boolean = false
    ): void {
        resources.release(execution.executionId);
        if (outcome === "completed") {
            transitionExecution(execution, TaskExecutionStatus.Completed);
            // 已经取消或失效的任务不能被这次成功盖回活动或完成。
            if (!isTerminalLifecycle(task.lifecycleState)) {
                // 还有排队的下一次执行时，这次完成不能把整个任务标成结束。
                task.lifecycleState = keepTaskOpen ? TaskLifecycleState.Active : TaskLifecycleState.Completed;
            }
            dependencies.notifyFinished(execution);
            return;
        }
        if (outcome === "expired") {
            transitionExecution(execution, TaskExecutionStatus.Expired);
            if (!isTerminalLifecycle(task.lifecycleState)) {
                task.lifecycleState = TaskLifecycleState.Expired;
            }
            return;
        }
        transitionExecution(execution, TaskExecutionStatus.Failed);
    }
}

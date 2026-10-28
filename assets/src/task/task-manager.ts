import { Instance, setInstance } from "../framwork/utils/instance";
import { ActivityManager } from "../world/activity-manager";
import { WorldClock } from "../world/world-clock";
import { TaskHandler } from "./pipeline/task-runtime";
import { PipelineSnapshot, TaskPipeline } from "./pipeline/task-pipeline";
import { ScheduleIndex } from "./schedule/schedule-index";
import { TaskBase } from "./task-base";
import { GameTime, TaskRecord } from "./task-contract";
import {
    TaskAsyncRecoveryPolicy,
    TaskBlockType,
    TaskCausalityPolicy,
    TaskExecutionMode,
    TaskExecutionStatus,
    TaskLatePolicy,
    TaskLifecycleState,
    TaskOverlapPolicy,
    TaskPartialSettlementPolicy,
    TaskSettleLevel,
    TaskTimePolicy,
} from "./task-define";

@setInstance
export class TaskManager {
    private readonly _schedule: ScheduleIndex = new ScheduleIndex();
    private readonly _pipeline: TaskPipeline = new TaskPipeline();
    private readonly _records: Map<string, TaskRecord> = new Map();
    private readonly _types: Map<string, TaskHandler> = new Map();

    public get Schedule(): ScheduleIndex {
        return this._schedule;
    }

    public get Pipeline(): TaskPipeline {
        return this._pipeline;
    }

    public init(): void {}

    /**
     * 登记任务。已经错过 nextSettleAt 的记录仍放进索引，
     * 由开始门按迟到策略决定补跑或过期，不在这里直接丢掉。
     */
    public addTask(task: TaskBase): void {
        if (task.Sequence === 0) {
            task.Sequence = this._pipeline.runtime.nextSequence();
        }
        const record = this._fromTask(task);
        this._remember(record);
        this._pipeline.runtime.setHandler(record.id, (_record, at) => {
            task.run(at);
        });
    }

    public addRecord(record: TaskRecord, handler?: (task: TaskRecord, now: number) => void): void {
        if (!Number.isInteger(record.nextSettleAt) || record.nextSettleAt < 0) {
            record.lifecycleState = TaskLifecycleState.Expired;
            this._records.set(record.id, record);
            this._pipeline.tasks.add(record);
            return;
        }
        this._remember(record);
        this._bind(record, handler);
    }

    /** 按任务 type 登记处理函数。函数本身不进存档，读档后用同一 type 再绑上。 */
    public registerType(type: string, handler: TaskHandler): void {
        this._types.set(type, handler);
    }

    public bindHandler(taskId: string, handler: TaskHandler): void {
        this._pipeline.runtime.setHandler(taskId, handler);
    }

    public rebindAndRecover(now: GameTime): void {
        for (const record of this._records.values()) {
            const typed = this._types.get(record.type);
            if (typed) {
                this._pipeline.runtime.setHandler(record.id, typed);
            }
        }
        this._pipeline.recoverOpen(now);
    }

    public cancel(taskId: string): void {
        const record = this._records.get(taskId);
        if (record) {
            this._schedule.remove(record);
        }
        this._pipeline.cancelTask(taskId);
    }

    public removeTask(task: TaskBase): void {
        const record = this._records.get(task.Id);
        if (!record) {
            return;
        }
        this._schedule.remove(record);
        this._records.delete(task.Id);
        this._pipeline.tasks.remove(task.Id);
        this._pipeline.runtime.remove(task.Id);
    }

    public record(taskId: string): TaskRecord | undefined {
        return this._records.get(taskId);
    }

    public records(): TaskRecord[] {
        return Array.from(this._records.values());
    }

    /** 用存档里的任务记录重建索引。已经在等待外部结果的任务不再排进时间表。 */
    public restore(records: readonly TaskRecord[], snapshot: PipelineSnapshot, now: GameTime): void {
        this._clearState();
        const openTaskIds = new Set(
            snapshot.executions
                .filter((execution) => isOpenExecution(execution.status))
                .map((execution) => execution.taskId)
        );
        for (const record of records) {
            this._records.set(record.id, record);
            this._pipeline.tasks.add(record);
        }
        const schedulable = records.filter((record) => {
            if (
                record.lifecycleState === TaskLifecycleState.Completed ||
                record.lifecycleState === TaskLifecycleState.Canceled ||
                record.lifecycleState === TaskLifecycleState.Expired
            ) {
                return false;
            }
            return !openTaskIds.has(record.id);
        });
        this._schedule.rebuild(schedulable, now);
        this._pipeline.importSnapshot(snapshot);
    }

    /** 新开局清空内存索引和按 type 登记的处理函数。 */
    public reset(): void {
        this._clearState();
        this._types.clear();
    }

    private _clearState(): void {
        this._records.clear();
        this._schedule.clear();
        this._pipeline.reset();
        (Instance(ActivityManager) as ActivityManager).reset();
    }

    private _bind(record: TaskRecord, handler?: TaskHandler): void {
        if (handler) {
            this._pipeline.runtime.setHandler(record.id, handler);
            return;
        }
        const typed = this._types.get(record.type);
        if (typed) {
            this._pipeline.runtime.setHandler(record.id, typed);
        }
    }

    private _remember(record: TaskRecord): void {
        this._records.set(record.id, record);
        this._pipeline.tasks.add(record);
        this._schedule.schedule(record, this._now());
    }

    private _fromTask(task: TaskBase): TaskRecord {
        return {
            id: task.Id,
            type: "task",
            startTime: task.StartTime,
            nextSettleAt: task.NextSettleAt,
            dueAt: task.NextSettleAt,
            startBefore: task.EndTime > 0 ? task.EndTime : undefined,
            settleLevel: TaskSettleLevel.Minute,
            sequenceType: task.SequenceType as TaskRecord["sequenceType"],
            priority: task.Priority,
            sequence: task.Sequence,
            executionMode: TaskExecutionMode.Sync,
            // 旧的阻塞标记没有资源声明，只能先映射成暂停世界。
            timePolicy: task.BlockType === TaskBlockType.Block ? TaskTimePolicy.PauseWorld : TaskTimePolicy.ContinueWorld,
            causalityPolicy: TaskCausalityPolicy.Independent,
            resourceClaims: [],
            dependsOn: [],
            startLatePolicy: TaskLatePolicy.Skip,
            commitLatePolicy: TaskLatePolicy.Skip,
            partialSettlementPolicy: TaskPartialSettlementPolicy.Drop,
            overlapPolicy: TaskOverlapPolicy.Skip,
            asyncRecoveryPolicy: TaskAsyncRecoveryPolicy.Cancel,
            payload: undefined,
            lifecycleState: TaskLifecycleState.Scheduled,
            revision: 1,
        };
    }

    private _now(): GameTime {
        return Math.floor(Instance(WorldClock).TotalGameTime);
    }
}

function isOpenExecution(status: TaskExecutionStatus): boolean {
    switch (status) {
        case TaskExecutionStatus.Ready:
        case TaskExecutionStatus.Running:
        case TaskExecutionStatus.Waiting:
        case TaskExecutionStatus.Prepared:
        case TaskExecutionStatus.Committing:
            return true;
        case TaskExecutionStatus.Completed:
        case TaskExecutionStatus.Failed:
        case TaskExecutionStatus.Canceled:
        case TaskExecutionStatus.Expired:
        case TaskExecutionStatus.Skipped:
            return false;
        default: {
            const neverStatus: never = status;
            void neverStatus;
            return false;
        }
    }
}

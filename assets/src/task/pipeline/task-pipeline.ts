import {
    ExecutionRecord,
    GameTime,
    makeExecutionId,
    TaskChangeSet,
    TaskRecord,
    TaskResourceClaim,
    TaskResultCommand,
} from "../task-contract";
import { resolvePartial } from "../schedule/cadence";
import {
    TaskAsyncRecoveryPolicy,
    TaskCausalityPolicy,
    TaskExecutionMode,
    TaskExecutionStatus,
    TaskLifecycleState,
    TaskOverlapPolicy,
    TaskResourceAccess,
    TaskTimePolicy,
} from "../task-define";
import { CommitGate } from "./commit-gate";
import { DependencyGraph } from "./dependency-graph";
import { EntityStore } from "./entity-store";
import { ExecutionRepository } from "./execution-repository";
import { IdempotencyLedger } from "./idempotency-ledger";
import { ReadyScheduler } from "./ready-scheduler";
import { DurableResultInbox } from "./result-inbox";
import { ResourceArbiter } from "./resource-arbiter";
import { SerialCommitQueue } from "./serial-commit-queue";
import { StartGate } from "./start-gate";
import { TaskExecutor } from "./task-executor";
import { TaskFinalizer } from "./task-finalizer";
import { TaskRepository } from "./task-repository";
import { TaskRuntime } from "./task-runtime";
import { TriggerGate } from "./trigger-gate";
import { ExternalWork } from "./external-work";

export type BoundaryOutcome = "continue" | "paused" | "awaiting" | "faulted";

export interface PipelineSnapshot {
    nextTaskSequence: number;
    nextCommandSequence: number;
    nextCommitSequence: number;
    tasks: TaskRecord[];
    executions: ExecutionRecord[];
    resultInbox: TaskResultCommand[];
    idempotency: { key: string; sequence: number }[];
    entities: { entityKey: string; version: number; value: number }[];
}

/**
 * 同步任务的执行协议。
 * 同一时刻队头被资源或依赖挡住时，后面的无冲突任务仍然可以启动。
 * handler 返回后立即提交，这里不 await 业务 Promise。
 */
export class TaskPipeline {
    public readonly tasks: TaskRepository = new TaskRepository();
    public readonly executions: ExecutionRepository = new ExecutionRepository();
    public readonly ready: ReadyScheduler = new ReadyScheduler();
    public readonly resources: ResourceArbiter = new ResourceArbiter();
    public readonly dependencies: DependencyGraph = new DependencyGraph();
    public readonly triggerGate: TriggerGate = new TriggerGate();
    public readonly startGate: StartGate = new StartGate();
    public readonly executor: TaskExecutor = new TaskExecutor();
    public readonly finalizer: TaskFinalizer = new TaskFinalizer();
    public readonly resultInbox: DurableResultInbox = new DurableResultInbox();
    public readonly runtime: TaskRuntime = new TaskRuntime();
    public readonly external: ExternalWork = new ExternalWork(this);
    public readonly entities: EntityStore = new EntityStore();
    public readonly idempotency: IdempotencyLedger = new IdempotencyLedger();
    public readonly commitGate: CommitGate;
    public readonly commits: SerialCommitQueue;
    public faultReason: string = "";
    public pauseTaskId: string = "";
    private _parked: TaskRecord[] = [];
    private _deferred: TaskRecord[] = [];
    private readonly _recovered: Set<string> = new Set();
    /** StopWorldUntilResult 或 PauseWorld 的异步执行。结果提交前世界不能越过当前秒。 */
    private _barrierExecutionId: string = "";

    public constructor() {
        this.commitGate = new CommitGate(this.entities, this.idempotency);
        this.commits = new SerialCommitQueue(this.entities, this.idempotency);
    }

    /** 时间继续往前走之前，把已经错过开始窗口的等待任务标成过期。 */
    public reclaim(now: GameTime): TaskRecord[] {
        const staying: TaskRecord[] = [];
        const ready: TaskRecord[] = [];
        for (const task of this._parked) {
            const gate = this.startGate.check(task, now);
            if (gate.decision === "expire") {
                // 正在等待外部结果的任务不能因为下一次排队过期而被一起取消。
                if (this._openExecutions(task.id).length === 0) {
                    task.lifecycleState = TaskLifecycleState.Expired;
                }
                continue;
            }
            if (this._canTake(task, now)) {
                ready.push(task);
                continue;
            }
            staying.push(task);
        }
        this._parked = staying;
        return ready;
    }

    public submitDue(tasks: readonly TaskRecord[], settleAt: GameTime): BoundaryOutcome {
        this.faultReason = "";
        this.pauseTaskId = "";
        this._deferred = [];
        const accepted: TaskRecord[] = [];
        for (const task of tasks) {
            const gate = this.triggerGate.check(task, settleAt);
            if (gate.decision === "execute") {
                accepted.push(task);
                continue;
            }
            if (gate.reason === "还没到触发时间") {
                this._deferred.push(task);
                continue;
            }
            if (gate.reason === "活动 revision 已变化") {
                task.lifecycleState = TaskLifecycleState.Expired;
            }
        }
        this.ready.enqueue(accepted);
        this._expireBeforeStart(settleAt);
        let guard = 0;
        while (this.ready.size > 0) {
            guard += 1;
            if (guard > 10000) {
                this.faultReason = "同一时刻无法选出可运行任务";
                this._deferred.push(...this.ready.drain());
                return "faulted";
            }
            const index = this.ready.indexOf((task) => this._canTake(task, settleAt));
            if (index < 0) {
                return this._parkOrFault(settleAt);
            }
            const task = this.ready.removeAt(index);
            const partial = resolvePartial(task);
            if (partial.kind === "drop") {
                task.lifecycleState = TaskLifecycleState.Expired;
                continue;
            }
            if (partial.kind === "defer") {
                // 比例必须在改 nextSettleAt 之前算好，否则再进来会看成完整周期。
                task.partialRatio = partial.ratio;
                task.nextSettleAt = partial.at;
                task.dueAt = partial.at;
                this._deferred.push(task);
                continue;
            }
            const execution = this._createExecution(task, settleAt);
            if (partial.kind === "partial") {
                execution.partialRatio = partial.ratio;
            }
            if (task.executionMode === TaskExecutionMode.Async) {
                const open = this._openExecutions(task.id).filter(
                    (item) => item.executionId !== execution.executionId
                );
                if (
                    open.length > 0 &&
                    this._overlap(task, open[0], execution, settleAt) === "handled"
                ) {
                    continue;
                }
            }
            if (!this.resources.tryAcquire(execution, this._claims(task))) {
                this.executions.remove(execution.executionId);
                this._parked.push(task);
                continue;
            }
            const outcome =
                task.executionMode === TaskExecutionMode.Async
                    ? this._runAsync(task, execution, settleAt)
                    : this._runAcquired(task, execution, settleAt);
            if (outcome !== "continue") {
                return outcome;
            }
        }
        return "continue";
    }

    public takeDeferred(): TaskRecord[] {
        const tasks = this._deferred;
        this._deferred = [];
        return tasks;
    }

    /**
     * 外部完成时只入队。
     * 不改世界状态，也不推进时钟。提交发生在下一次安全点。
     */
    public acceptExternalResult(input: {
        executionId: string;
        taskId: string;
        taskRevision: number;
        success: boolean;
        payload?: unknown;
        errorCode?: string;
        idempotencyKey?: string;
        externalCorrelationId?: string;
    }): void {
        const sequence = this.resultInbox.takeSequence();
        this.resultInbox.enqueue({
            commandId: `result:${sequence}`,
            commandSequence: sequence,
            executionId: input.executionId,
            taskId: input.taskId,
            taskRevision: input.taskRevision,
            externalCorrelationId: input.externalCorrelationId,
            acceptedAtGameTime: 0,
            completedAtRealTime: 0,
            success: input.success,
            payload: input.payload,
            errorCode: input.errorCode,
            idempotencyKey: input.idempotencyKey ?? input.executionId,
        });
    }

    /** 当前边界已经处理完，可以按序号提交回流结果。 */
    public drainResults(now: GameTime): void {
        const deferred: TaskResultCommand[] = [];
        for (const command of this.resultInbox.drain()) {
            const execution = this.executions.get(command.executionId);
            if (!execution) {
                if (this._shouldHoldCommand(command)) {
                    deferred.push(command);
                }
                continue;
            }
            if (!this._isOpen(execution)) {
                continue;
            }
            command.acceptedAtGameTime = now;
            const task = this.tasks.get(command.taskId);
            if (
                !task ||
                command.taskRevision !== task.revision ||
                command.taskRevision !== execution.taskRevision
            ) {
                this._closeExternal(task, execution, "failed");
                continue;
            }
            if (task.lifecycleState === TaskLifecycleState.Canceled) {
                execution.status = TaskExecutionStatus.Canceled;
                this.resources.release(execution.executionId);
                this._clearBarrier(execution.executionId);
                continue;
            }
            if (!command.success) {
                this._closeExternal(task, execution, "failed");
                continue;
            }
            const changeSet = this.executor.prepareResult(execution, command.payload);
            changeSet.idempotencyKey = command.idempotencyKey || execution.idempotencyKey;
            execution.readSet = changeSet.readSet;
            execution.preparedResult = command.payload;
            const gate = this.commitGate.check(task, execution, changeSet, now);
            if (gate.decision === "execute") {
                this._applyChange(execution, changeSet, gate.reason);
                this._closeExternal(task, execution, "completed");
                continue;
            }
            if (gate.decision === "expire") {
                this._closeExternal(task, execution, "expired");
                continue;
            }
            this._closeExternal(task, execution, "failed");
        }
        for (const command of deferred) {
            this.resultInbox.enqueue(command);
        }
    }

    /** 游戏时间已经越过等待期限。按恢复策略重发、查询、取消或补偿，并释放资源。 */
    public sweepTimeouts(now: GameTime): void {
        for (const execution of this.executions.list()) {
            if (
                !this._isOpen(execution) ||
                execution.timeoutAt === undefined ||
                now <= execution.timeoutAt
            ) {
                continue;
            }
            this._recover(this.tasks.get(execution.taskId), execution, now);
        }
    }

    /** 读档后按恢复策略处理仍开着的外部执行。每个执行只处理一次。 */
    public recoverOpen(now: GameTime): void {
        for (const execution of this.executions.list()) {
            if (!this._isOpen(execution) || this._recovered.has(execution.executionId)) {
                continue;
            }
            this._recovered.add(execution.executionId);
            const task = this.tasks.get(execution.taskId);
            if (!task) {
                continue;
            }
            // 取消和补偿留给超时或显式中止。读档本身还留着这条等待，迟到结果仍可提交。
            if (
                task.asyncRecoveryPolicy === TaskAsyncRecoveryPolicy.Retry ||
                task.asyncRecoveryPolicy === TaskAsyncRecoveryPolicy.Reissue
            ) {
                this._reissue(task, execution, now);
            }
        }
    }

    public cancelTask(taskId: string): void {
        const task = this.tasks.get(taskId);
        if (task) {
            task.lifecycleState = TaskLifecycleState.Canceled;
        }
        for (const execution of this._openExecutions(taskId)) {
            execution.status = TaskExecutionStatus.Canceled;
            this.resources.release(execution.executionId);
            this._clearBarrier(execution.executionId);
        }
    }

    public get isBlocked(): boolean {
        if (!this._barrierExecutionId) {
            return false;
        }
        const execution = this.executions.get(this._barrierExecutionId);
        if (!execution || !this._isOpen(execution)) {
            this._barrierExecutionId = "";
            return false;
        }
        return true;
    }

    public exportSnapshot(): PipelineSnapshot {
        return {
            nextTaskSequence: this.runtime.peekSequence(),
            nextCommandSequence: this.resultInbox.peekSequence(),
            nextCommitSequence: this.idempotency.nextCommitSequence(),
            tasks: this.tasks.list(),
            executions: this.executions.list(),
            resultInbox: this.resultInbox.list(),
            idempotency: this.idempotency.exportEntries(),
            entities: this.entities.exportEntries(),
        };
    }

    /** 任务记录已经放回仓库。这里恢复执行、账本、收件箱和资源占用。 */
    public importSnapshot(snapshot: PipelineSnapshot): void {
        this.executions.clear();
        this.resources.clear();
        this.dependencies.clear();
        this._parked = [];
        this._deferred = [];
        this._recovered.clear();
        this._barrierExecutionId = "";
        this.faultReason = "";
        this.pauseTaskId = "";
        this.runtime.restoreSequence(snapshot.nextTaskSequence);
        this.idempotency.restore(snapshot.idempotency, snapshot.nextCommitSequence);
        this.entities.restore(snapshot.entities);
        this.resultInbox.restore(snapshot.resultInbox, snapshot.nextCommandSequence);
        let barrier: ExecutionRecord | undefined;
        for (const execution of snapshot.executions) {
            const task = this.tasks.get(execution.taskId);
            if (!task) {
                continue;
            }
            this.executions.add({ execution, task });
            if (execution.status === TaskExecutionStatus.Completed) {
                this.dependencies.notifyFinished(execution);
            }
            if (!this._isOpen(execution)) {
                continue;
            }
            if (!this.resources.tryAcquire(execution, this._claims(task))) {
                throw new Error(`读档后无法恢复资源占用: ${execution.executionId}`);
            }
            if (this._shouldStop(task) && (!barrier || execution.triggerAt < barrier.triggerAt)) {
                barrier = execution;
            }
        }
        if (barrier) {
            this._barrierExecutionId = barrier.executionId;
            this.pauseTaskId = barrier.taskId;
        }
    }

    public reset(): void {
        this.tasks.clear();
        this.executions.clear();
        this.ready.clear();
        this.resources.clear();
        this.dependencies.clear();
        this.idempotency.clear();
        this.entities.clear();
        this.runtime.clear();
        this._parked = [];
        this._deferred = [];
        this._recovered.clear();
        this._barrierExecutionId = "";
        this.faultReason = "";
        this.pauseTaskId = "";
        this.resultInbox.clear();
        this.external.clear();
    }

    private _expireBeforeStart(settleAt: GameTime): void {
        const kept: TaskRecord[] = [];
        for (const task of this.ready.drain()) {
            if (this.startGate.check(task, settleAt).decision === "expire") {
                task.lifecycleState = TaskLifecycleState.Expired;
                continue;
            }
            kept.push(task);
        }
        this.ready.enqueue(kept);
    }

    private _canTake(task: TaskRecord, now: GameTime): boolean {
        if (
            task.lifecycleState === TaskLifecycleState.Completed ||
            task.lifecycleState === TaskLifecycleState.Canceled ||
            task.lifecycleState === TaskLifecycleState.Expired
        ) {
            return false;
        }
        if (this.startGate.check(task, now).decision !== "execute") {
            return false;
        }
        if (!this.dependencies.isRunnable(task)) {
            return false;
        }
        if (this.resources.canAcquire(this._claims(task))) {
            return true;
        }
        // 自己上一次异步执行还占着资源时，合并和跳过不用再抢一次锁。
        return (
            task.executionMode === TaskExecutionMode.Async &&
            (task.overlapPolicy === TaskOverlapPolicy.Coalesce ||
                task.overlapPolicy === TaskOverlapPolicy.Skip) &&
            this._openExecutions(task.id).length > 0
        );
    }

    /** 剩下的任务如果互相等待，判定成环；只是资源被别人占着则先停住。 */
    private _parkOrFault(settleAt: GameTime): BoundaryOutcome {
        const waiting = this.ready.tasks();
        if (this._isCycle(waiting, settleAt)) {
            this.faultReason = `依赖成环: ${waiting.map((task) => task.id).join(",")}`;
            this._deferred.push(...this.ready.drain());
            return "faulted";
        }
        this._parked.push(...this.ready.drain());
        return "continue";
    }

    private _isCycle(tasks: readonly TaskRecord[], settleAt: GameTime): boolean {
        if (tasks.length === 0) {
            return false;
        }
        const ids = new Set(tasks.map((task) => makeExecutionId(task.id, settleAt, task.revision)));
        return tasks.every((task) => {
            if (task.dependsOn.length === 0 || this.dependencies.isRunnable(task)) {
                return false;
            }
            return task.dependsOn.every((executionId) => ids.has(executionId));
        });
    }

    /**
     * 异步任务拿到资源后立刻让出调度。
     * handler 只负责发起外部工作，返回值不提交。结果以后走 acceptExternalResult。
     */
    private _runAsync(
        task: TaskRecord,
        execution: ExecutionRecord,
        settleAt: GameTime
    ): BoundaryOutcome {
        execution.status = TaskExecutionStatus.Waiting;
        task.lifecycleState = TaskLifecycleState.Active;
        if (task.timeoutGameSeconds !== undefined) {
            execution.timeoutAt = settleAt + task.timeoutGameSeconds;
        }
        this.executor.startAsync({ execution, task });
        if (task.causalityPolicy !== TaskCausalityPolicy.UseRecordedResult) {
            try {
                this.runtime.handler(task.id)?.(task, settleAt);
            } catch (error) {
                this.faultReason = error instanceof Error ? error.message : String(error);
                this._deadLetter(task, execution);
                this._deferred.push(...this.ready.drain());
                return "faulted";
            }
        }
        if (this._shouldStop(task)) {
            this._barrierExecutionId = execution.executionId;
            this.pauseTaskId = task.id;
            this._deferred.push(...this.ready.drain());
            return "awaiting";
        }
        return "continue";
    }

    private _overlap(
        task: TaskRecord,
        current: ExecutionRecord,
        created: ExecutionRecord,
        settleAt: GameTime
    ): "start" | "handled" {
        switch (task.overlapPolicy) {
            case TaskOverlapPolicy.Coalesce:
                current.settleIntervalTo = settleAt;
                this.executions.remove(created.executionId);
                this.resources.release(created.executionId);
                return "handled";
            case TaskOverlapPolicy.Skip:
                this.executions.remove(created.executionId);
                this.resources.release(created.executionId);
                return "handled";
            case TaskOverlapPolicy.Queue:
            case TaskOverlapPolicy.Parallel:
                return "start";
            default: {
                const neverPolicy: never = task.overlapPolicy;
                this.faultReason = String(neverPolicy);
                return "handled";
            }
        }
    }

    private _runAcquired(
        task: TaskRecord,
        execution: ExecutionRecord,
        settleAt: GameTime
    ): BoundaryOutcome {
        try {
            let changeSet = this.executor.executeSync(
                { execution, task },
                this.runtime.handler(task.id),
                settleAt
            );
            let gate = this.commitGate.check(task, execution, changeSet, settleAt);
            // 旧读集冲突时只重算一次。第二次仍然冲突就拒绝，避免两个旧变更互相覆盖。
            if (
                gate.decision === "skip" &&
                (gate.reason === "版本冲突" || gate.reason === "写入没有读集")
            ) {
                changeSet = this.executor.executeSync(
                    { execution, task },
                    this.runtime.handler(task.id),
                    settleAt
                );
                gate = this.commitGate.check(task, execution, changeSet, settleAt);
            }
            if (gate.decision === "execute") {
                this._applyChange(execution, changeSet, gate.reason);
                return this._finishSync(task, execution, settleAt);
            }
            if (gate.decision === "expire") {
                this.finalizer.finish(
                    task,
                    execution,
                    "expired",
                    this.resources,
                    this.dependencies
                );
                return "continue";
            }
            if (gate.decision === "skip" || gate.decision === "reschedule") {
                this.finalizer.finish(task, execution, "failed", this.resources, this.dependencies);
                return "continue";
            }
            const neverDecision: never = gate.decision;
            this.faultReason = String(neverDecision);
            return "faulted";
        } catch (error) {
            this.faultReason = error instanceof Error ? error.message : String(error);
            this._deadLetter(task, execution);
            this._deferred.push(...this.ready.drain());
            return "faulted";
        }
    }

    private _applyChange(
        execution: ExecutionRecord,
        changeSet: TaskChangeSet,
        reason: string
    ): void {
        if (reason === "幂等命中") {
            return;
        }
        this.commits.apply(this._scaleChange(changeSet, execution.partialRatio));
    }

    /** 按末段比例缩放写入差值。比例为 1 时保持原命令。 */
    private _scaleChange(changeSet: TaskChangeSet, ratio: number | undefined): TaskChangeSet {
        if (ratio === undefined || ratio >= 1) {
            return changeSet;
        }
        const commands = changeSet.commands.map((command) => {
            if (!command || typeof command !== "object") {
                return command;
            }
            const write = command as { entityKey?: unknown; value?: unknown };
            if (typeof write.entityKey !== "string" || typeof write.value !== "number") {
                return command;
            }
            const current = this.entities.value(write.entityKey) ?? 0;
            const scaled = current + (write.value - current) * ratio;
            return { entityKey: write.entityKey, value: Math.round(scaled) };
        });
        return { ...changeSet, commands };
    }

    private _shouldHoldCommand(command: TaskResultCommand): boolean {
        const task = this.tasks.get(command.taskId);
        if (
            !task ||
            task.lifecycleState === TaskLifecycleState.Completed ||
            task.lifecycleState === TaskLifecycleState.Canceled ||
            task.lifecycleState === TaskLifecycleState.Expired
        ) {
            return false;
        }
        const expected = makeExecutionId(task.id, task.nextSettleAt, task.revision);
        return command.executionId === expected || command.executionId.startsWith(`${expected}#`);
    }

    private _finishSync(
        task: TaskRecord,
        execution: ExecutionRecord,
        settleAt: GameTime
    ): BoundaryOutcome {
        const reschedule = Number.isInteger(task.nextSettleAt) && task.nextSettleAt > settleAt;
        this.finalizer.finish(
            task,
            execution,
            "completed",
            this.resources,
            this.dependencies,
            reschedule
        );
        if (reschedule) {
            this._deferred.push(task);
        }
        if (task.timePolicy === TaskTimePolicy.PauseWorld) {
            this.pauseTaskId = task.id;
            this._deferred.push(...this.ready.drain());
            return "paused";
        }
        return "continue";
    }

    private _claims(task: TaskRecord): TaskResourceClaim[] {
        if (!task.serialKey) {
            return task.resourceClaims;
        }
        return [
            ...task.resourceClaims,
            { resourceKey: `serial:${task.serialKey}`, access: TaskResourceAccess.Exclusive },
        ];
    }

    private _recover(
        task: TaskRecord | undefined,
        execution: ExecutionRecord,
        now: GameTime
    ): void {
        const policy = task?.asyncRecoveryPolicy ?? execution.recoveryPolicy;
        switch (policy) {
            case TaskAsyncRecoveryPolicy.Retry:
            case TaskAsyncRecoveryPolicy.Reissue:
                this._reissue(task, execution, now);
                return;
            case TaskAsyncRecoveryPolicy.QueryRemote:
                // 超时后不再占资源。执行仍保持等待，迟到的结果还可以提交。
                this.resources.release(execution.executionId);
                execution.timeoutAt = undefined;
                this._clearBarrier(execution.executionId);
                return;
            case TaskAsyncRecoveryPolicy.Cancel:
                if (task) {
                    task.lifecycleState = TaskLifecycleState.Canceled;
                }
                execution.status = TaskExecutionStatus.Canceled;
                this.resources.release(execution.executionId);
                this._clearBarrier(execution.executionId);
                return;
            case TaskAsyncRecoveryPolicy.Compensate:
                this._closeExternal(task, execution, "expired");
                return;
            default: {
                const neverPolicy: never = policy;
                this.faultReason = String(neverPolicy);
            }
        }
    }

    private _reissue(
        task: TaskRecord | undefined,
        execution: ExecutionRecord,
        now: GameTime
    ): void {
        const limit = task?.maxAttempts ?? 3;
        if (!task || execution.attempt >= limit) {
            this._deadLetter(task, execution);
            return;
        }
        execution.attempt += 1;
        if (task.timeoutGameSeconds !== undefined) {
            execution.timeoutAt = now + task.timeoutGameSeconds;
        }
        if (task.causalityPolicy === TaskCausalityPolicy.UseRecordedResult) {
            return;
        }
        try {
            this.runtime.handler(task.id)?.(task, now);
        } catch (error) {
            this.faultReason = error instanceof Error ? error.message : String(error);
            this._deadLetter(task, execution);
        }
    }

    private _deadLetter(task: TaskRecord | undefined, execution: ExecutionRecord): void {
        this._closeExternal(task, execution, "failed");
        if (task && task.lifecycleState !== TaskLifecycleState.Completed) {
            task.lifecycleState = TaskLifecycleState.Expired;
        }
    }

    private _closeExternal(
        task: TaskRecord | undefined,
        execution: ExecutionRecord,
        outcome: "completed" | "expired" | "failed"
    ): void {
        if (!task) {
            execution.status =
                outcome === "completed"
                    ? TaskExecutionStatus.Completed
                    : TaskExecutionStatus.Failed;
            this.resources.release(execution.executionId);
            this._clearBarrier(execution.executionId);
            return;
        }
        const keepOpen = outcome === "completed" && this._shouldKeepTaskOpen(task, execution);
        this.finalizer.finish(
            task,
            execution,
            outcome,
            this.resources,
            this.dependencies,
            keepOpen
        );
        this._clearBarrier(execution.executionId);
    }

    private _shouldKeepTaskOpen(task: TaskRecord, execution: ExecutionRecord): boolean {
        if (this._parked.some((item) => item.id === task.id)) {
            return true;
        }
        return this._openExecutions(task.id).some(
            (item) => item.executionId !== execution.executionId
        );
    }

    private _clearBarrier(executionId: string): void {
        if (this._barrierExecutionId === executionId) {
            this._barrierExecutionId = "";
        }
    }

    private _shouldStop(task: TaskRecord): boolean {
        return (
            task.causalityPolicy === TaskCausalityPolicy.StopWorldUntilResult ||
            task.timePolicy === TaskTimePolicy.PauseWorld
        );
    }

    private _openExecutions(taskId: string): ExecutionRecord[] {
        return this.executions
            .list()
            .filter((execution) => execution.taskId === taskId && this._isOpen(execution));
    }

    private _isOpen(execution: ExecutionRecord): boolean {
        return (
            execution.status === TaskExecutionStatus.Ready ||
            execution.status === TaskExecutionStatus.Running ||
            execution.status === TaskExecutionStatus.Waiting ||
            execution.status === TaskExecutionStatus.Prepared ||
            execution.status === TaskExecutionStatus.Committing
        );
    }

    private _createExecution(task: TaskRecord, settleAt: GameTime): ExecutionRecord {
        const baseId = makeExecutionId(task.id, settleAt, task.revision);
        let executionId = baseId;
        let generation = 2;
        while (this.executions.get(executionId)) {
            executionId = `${baseId}#${generation}`;
            generation += 1;
        }
        const execution: ExecutionRecord = {
            executionId,
            taskId: task.id,
            taskRevision: task.revision,
            triggerAt: settleAt,
            settleIntervalFrom: task.nextSettleAt,
            settleIntervalTo: settleAt,
            status: TaskExecutionStatus.Running,
            priority: task.priority,
            sequence: task.sequence,
            attempt: 1,
            acquiredResources: [],
            readSet: {},
            recoveryPolicy: task.asyncRecoveryPolicy ?? TaskAsyncRecoveryPolicy.Cancel,
            idempotencyKey: executionId,
        };
        this.executions.add({ execution, task });
        return execution;
    }
}

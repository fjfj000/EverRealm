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
    isTerminalLifecycle,
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
import { TriggerGate, type GateResult } from "./trigger-gate";
import { ExternalWork } from "./external-work";
import { transitionExecution } from "./execution-status";

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
    /** 任务主记录。时间表只是索引，以这里的记录为准。 */
    public readonly tasks: TaskRepository = new TaskRepository();
    /** 每次触发生成的执行记录。一条任务可以同时有多条。 */
    public readonly executions: ExecutionRepository = new ExecutionRepository();
    /** 这一刻已经通过触发门、正在排队启动的任务。队头受阻时继续找后面能跑的。 */
    public readonly ready: ReadyScheduler = new ReadyScheduler();
    /** 资源占用。读可以并存，写和独占会挡住其他访问。 */
    public readonly resources: ResourceArbiter = new ResourceArbiter();
    /** 执行之间的依赖。dependsOn 里的执行没完成，这条就不能开始。 */
    public readonly dependencies: DependencyGraph = new DependencyGraph();
    /** 从时间表取出时过滤已结束的任务，并发现活动版本已经变化。 */
    public readonly triggerGate: TriggerGate = new TriggerGate();
    /** 真正开始前检查 startBefore 和迟到策略。 */
    public readonly startGate: StartGate = new StartGate();
    /** 同步调用收成 TaskChangeSet；异步调用只发起，返回值不提交。两种结果都按执行自己的编号规范化。 */
    public readonly executor: TaskExecutor = new TaskExecutor();
    /** 一次执行结束后释放资源、通知依赖，并更新任务生命周期。 */
    public readonly finalizer: TaskFinalizer = new TaskFinalizer();
    /** 尚未提交的外部结果，按 commandSequence 排序。 */
    public readonly resultInbox: DurableResultInbox = new DurableResultInbox();
    /** 处理函数和任务序号。函数不进存档，读档后按 type 再绑上。 */
    public readonly runtime: TaskRuntime = new TaskRuntime();
    /** 外部请求的单号。complete、fail、abort 只把结果放进收件箱。 */
    public readonly external: ExternalWork = new ExternalWork(this);
    /** 实体的当前数值和版本。只有提交成功才会改版本。 */
    public readonly entities: EntityStore = new EntityStore();
    /** 已经提交过的幂等键，用来挡住同一次执行的重复写入。 */
    public readonly idempotency: IdempotencyLedger = new IdempotencyLedger();
    /** 提交前检查幂等键、commitBefore、读集和版本是否仍匹配。 */
    public readonly commitGate: CommitGate;
    /** 串行写入实体并记账。这段中间不能等待外部结果。 */
    public readonly commits: SerialCommitQueue;
    public faultReason: string = "";
    public pauseTaskId: string = "";
    /** 已经到期并离开时间表，但资源或依赖还没就绪，留在管线里等下一轮再试。 */
    private _parked: TaskRecord[] = [];
    /** 这一轮不执行，边界结束后要放回时间表。包括还没到点、末段推迟、排了下一次，以及暂停或失败时还没跑的任务。 */
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
            if (isTerminalLifecycle(task.lifecycleState)) {
                continue;
            }
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
                this._expireTask(task);
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
                this._expireTask(task);
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

    /**
     * 当前边界已经处理完，可以按序号提交回流结果。
     * 返回需要放回时间表的任务。调用方负责插回去。
     */
    public drainResults(now: GameTime): TaskRecord[] {
        const deferred: TaskResultCommand[] = [];
        const reschedule: TaskRecord[] = [];
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
                if (task) {
                    this._concludeRejected(task, now, reschedule);
                }
                continue;
            }
            if (isTerminalLifecycle(task.lifecycleState)) {
                this._rejectClosedTask(task, execution);
                continue;
            }
            if (!command.success) {
                this._closeExternal(task, execution, "failed");
                this._concludeRejected(task, now, reschedule);
                continue;
            }
            const changeSet = this.executor.prepareResult(execution, command.payload);
            if (!changeSet) {
                execution.preparedResult = command.payload;
                this._closeExternal(task, execution, "failed");
                this._concludeRejected(task, now, reschedule);
                continue;
            }
            execution.preparedResult = command.payload;
            const gate = this._stageCommit(task, execution, changeSet, now);
            if (gate.decision === "execute") {
                this._closeExternal(task, execution, "completed");
                continue;
            }
            if (gate.decision === "expire") {
                this._closeExternal(task, execution, "expired");
                this._sealOpenExecutions(task.id, execution.executionId);
                continue;
            }
            this._closeExternal(task, execution, "failed");
            this._concludeRejected(task, now, reschedule);
        }
        for (const command of deferred) {
            this.resultInbox.enqueue(command);
        }
        return reschedule;
    }

    /** 游戏时间已经越过等待期限。按恢复策略重发、查询、取消或补偿，并释放资源。 */
    public sweepTimeouts(now: GameTime): void {
        for (const execution of this.executions.list()) {
            /** 如果执行还在，并且超时，则按恢复策略处理 */
            if (this._isOpen(execution) && now > execution.timeoutAt) {
                this._recover(this.tasks.get(execution.taskId), execution, now);
            }
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
                this._recover(task, execution, now);
            }
        }
    }

    public cancelTask(taskId: string): void {
        const task = this.tasks.get(taskId);
        if (task && !isTerminalLifecycle(task.lifecycleState)) {
            task.lifecycleState = TaskLifecycleState.Canceled;
        }
        for (const execution of this._openExecutions(taskId)) {
            transitionExecution(execution, TaskExecutionStatus.Canceled);
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
                // 还有未结束的执行时，只丢掉这次迟到的开始，不把整条任务写成失效。
                if (
                    this._openExecutions(task.id).length === 0 &&
                    !isTerminalLifecycle(task.lifecycleState)
                ) {
                    task.lifecycleState = TaskLifecycleState.Expired;
                }
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
        transitionExecution(execution, TaskExecutionStatus.Running);
        transitionExecution(execution, TaskExecutionStatus.Waiting);
        task.lifecycleState = TaskLifecycleState.Active;
        if (task.timeoutGameSeconds !== undefined) {
            execution.timeoutAt = settleAt + task.timeoutGameSeconds;
        }
        this.executor.startAsync({ execution, task });
        if (task.causalityPolicy !== TaskCausalityPolicy.UseRecordedResult) {
            try {
                this.executor.invokeAsync(
                    { execution, task },
                    this.runtime.handler(task.id),
                    settleAt
                );
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
            transitionExecution(execution, TaskExecutionStatus.Running);
            let changeSet = this.executor.executeSync(
                { execution, task },
                this.runtime.handler(task.id),
                settleAt
            );
            // 处理函数里已经取消或关掉这次执行时，不再提交，也不改写终态。
            if (isTerminalLifecycle(task.lifecycleState) || !this._isOpen(execution)) {
                this.resources.release(execution.executionId);
                return "continue";
            }
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
                if (isTerminalLifecycle(task.lifecycleState) || !this._isOpen(execution)) {
                    this.resources.release(execution.executionId);
                    return "continue";
                }
                gate = this._stageCommit(task, execution, changeSet, settleAt);
            } else {
                gate = this._stageCommit(task, execution, changeSet, settleAt, gate);
            }
            if (gate.decision === "execute") {
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
                this._sealOpenExecutions(task.id, execution.executionId);
                return "continue";
            }
            if (gate.decision === "skip" || gate.decision === "reschedule") {
                this.finalizer.finish(task, execution, "failed", this.resources, this.dependencies);
                this._concludeRejected(task, settleAt, this._deferred);
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

    /**
     * 同步和异步共用的提交前步骤。
     * 结果先标成已准备。还没有检查结果时，再核对幂等、时限、读集和版本。通过且不是重复提交时才写入。
     */
    private _stageCommit(
        task: TaskRecord,
        execution: ExecutionRecord,
        changeSet: TaskChangeSet,
        now: GameTime,
        checked?: GateResult
    ): GateResult {
        transitionExecution(execution, TaskExecutionStatus.Prepared);
        execution.readSet = changeSet.readSet;
        // 同一份结果已经检查过就沿用。重算后的新结果必须再查一次。
        const gate = checked ?? this.commitGate.check(task, execution, changeSet, now);
        if (gate.decision === "execute" && gate.reason !== "幂等命中") {
            transitionExecution(execution, TaskExecutionStatus.Committing);
            this._applyChange(execution, changeSet);
        }
        return gate;
    }

    private _applyChange(execution: ExecutionRecord, changeSet: TaskChangeSet): void {
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
        if (reschedule && !isTerminalLifecycle(task.lifecycleState)) {
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
                this._retry(task, execution, now);
                return;
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
                if (task && !isTerminalLifecycle(task.lifecycleState)) {
                    task.lifecycleState = TaskLifecycleState.Canceled;
                }
                transitionExecution(execution, TaskExecutionStatus.Canceled);
                this.resources.release(execution.executionId);
                this._clearBarrier(execution.executionId);
                if (task) {
                    this._sealOpenExecutions(task.id, execution.executionId);
                }
                return;
            case TaskAsyncRecoveryPolicy.Compensate:
                this._closeExternal(task, execution, "expired");
                if (task) {
                    this._sealOpenExecutions(task.id, execution.executionId);
                }
                return;
            default: {
                const neverPolicy: never = policy;
                this.faultReason = String(neverPolicy);
            }
        }
    }

    /** 再次询问同一张外部单。单号不变，只增加尝试次数。 */
    private _retry(task: TaskRecord | undefined, execution: ExecutionRecord, now: GameTime): void {
        this._callHandlerAgain(task, execution, now, false);
    }

    /** 作废旧单后再调用处理函数。下次 issue 会按新的尝试次数生成单号。 */
    private _reissue(
        task: TaskRecord | undefined,
        execution: ExecutionRecord,
        now: GameTime
    ): void {
        this._callHandlerAgain(task, execution, now, true);
    }

    private _callHandlerAgain(
        task: TaskRecord | undefined,
        execution: ExecutionRecord,
        now: GameTime,
        renewOrder: boolean
    ): void {
        const limit = task?.maxAttempts ?? 3;
        if (!task || execution.attempt >= limit) {
            this._deadLetter(task, execution);
            return;
        }
        if (renewOrder) {
            this._voidExternalOrder(execution);
        }
        execution.attempt += 1;
        if (task.timeoutGameSeconds !== undefined) {
            execution.timeoutAt = now + task.timeoutGameSeconds;
        }
        if (task.causalityPolicy === TaskCausalityPolicy.UseRecordedResult) {
            return;
        }
        try {
            this.executor.invokeAsync({ execution, task }, this.runtime.handler(task.id), now);
        } catch (error) {
            this.faultReason = error instanceof Error ? error.message : String(error);
            this._deadLetter(task, execution);
        }
    }

    private _voidExternalOrder(execution: ExecutionRecord): void {
        const correlationId = execution.externalCorrelationId;
        if (correlationId !== undefined) {
            this.external.discard(correlationId);
        }
        execution.externalCorrelationId = undefined;
    }

    private _deadLetter(task: TaskRecord | undefined, execution: ExecutionRecord): void {
        this._closeExternal(task, execution, "failed");
        if (task) {
            this._expireTask(task);
        }
    }

    /** 整条任务失效，并关掉其余还开着的执行，避免它们继续提交。 */
    private _expireTask(task: TaskRecord): void {
        /** 如果任务不是终止状态，则标记为失效 */
        if (!isTerminalLifecycle(task.lifecycleState)) {
            task.lifecycleState = TaskLifecycleState.Expired;
        }
        this._sealOpenExecutions(task.id, undefined);
    }

    /**
     * 这次提交被拒绝。
     * 还有更晚的结算点就保持活动并排回去；否则写成失效，避免读档时再跑一次。
     */
    private _concludeRejected(
        task: TaskRecord,
        settleAt: GameTime,
        reschedule: TaskRecord[]
    ): void {
        if (isTerminalLifecycle(task.lifecycleState)) {
            return;
        }
        if (Number.isInteger(task.nextSettleAt) && task.nextSettleAt > settleAt) {
            task.lifecycleState = TaskLifecycleState.Active;
            reschedule.push(task);
            return;
        }
        if (this._openExecutions(task.id).length > 0) {
            return;
        }
        task.lifecycleState = TaskLifecycleState.Expired;
    }

    /** 任务已经结束时，这条执行不再提交。 */
    private _rejectClosedTask(task: TaskRecord, execution: ExecutionRecord): void {
        transitionExecution(
            execution,
            task.lifecycleState === TaskLifecycleState.Canceled
                ? TaskExecutionStatus.Canceled
                : TaskExecutionStatus.Expired
        );
        this.resources.release(execution.executionId);
        this._clearBarrier(execution.executionId);
    }

    private _sealOpenExecutions(taskId: string, keepExecutionId: string | undefined): void {
        for (const execution of this._openExecutions(taskId)) {
            if (execution.executionId === keepExecutionId) {
                continue;
            }
            transitionExecution(execution, TaskExecutionStatus.Expired);
            this.resources.release(execution.executionId);
            this._clearBarrier(execution.executionId);
        }
    }

    /**
     * 收口一次正在等待外部结果的执行。
     * External 指执行还停在外部回流上，不是只服务 ExternalWork。
     * 同步任务在处理函数返回后走 _finishSync，不进这里。
     */
    private _closeExternal(
        task: TaskRecord | undefined,
        execution: ExecutionRecord,
        outcome: "completed" | "expired" | "failed"
    ): void {
        if (!task) {
            transitionExecution(
                execution,
                outcome === "completed" ? TaskExecutionStatus.Completed : TaskExecutionStatus.Failed
            );
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

    /** 获取任务的所有未结束的executions */
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
            status: TaskExecutionStatus.Ready,
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

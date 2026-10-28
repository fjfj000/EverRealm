import { ExecutionRecord, TaskChangeSet, TaskRecord, TaskResultCommand } from "../task-contract";
import { TaskLatePolicy } from "../task-define";
import { EntityStore } from "./entity-store";
import { IdempotencyLedger } from "./idempotency-ledger";
import { GateResult } from "./trigger-gate";

/**
 * 提交前复验 commitBefore、幂等键和 readSet 版本。
 * 串行本身不能挡住两个都读到旧版本的变更。
 */
export class CommitGate {
    public constructor(
        private readonly _entities: EntityStore,
        private readonly _ledger: IdempotencyLedger
    ) {}

    public check(task: TaskRecord, execution: ExecutionRecord, changeSet: TaskChangeSet, now: number): GateResult {
        void execution;
        if (this._ledger.has(changeSet.idempotencyKey)) {
            return { decision: "execute", reason: "幂等命中" };
        }
        if (task.commitBefore !== undefined && now > task.commitBefore) {
            return this._lateResult(task.commitLatePolicy, "已经超过最晚提交时间");
        }
        const missingRead = this._writeWithoutRead(changeSet);
        if (missingRead) {
            return { decision: "skip", reason: "写入没有读集" };
        }
        if (!this._entities.canCommit(changeSet.readSet)) {
            return { decision: "skip", reason: "版本冲突" };
        }
        return { decision: "execute", reason: "可以提交" };
    }

    public checkChangeSet(execution: ExecutionRecord, changeSet: TaskChangeSet): GateResult {
        void execution;
        if (this._ledger.has(changeSet.idempotencyKey)) {
            return { decision: "execute", reason: "幂等命中" };
        }
        if (!this._entities.canCommit(changeSet.readSet)) {
            return { decision: "skip", reason: "版本冲突" };
        }
        return { decision: "execute", reason: "可以提交" };
    }

    public checkResult(execution: ExecutionRecord, command: TaskResultCommand): GateResult {
        void execution;
        if (this._ledger.has(command.idempotencyKey)) {
            return { decision: "execute", reason: "幂等命中" };
        }
        return { decision: "execute", reason: "结果可以提交" };
    }

    private _writeWithoutRead(changeSet: TaskChangeSet): boolean {
        for (const command of changeSet.commands) {
            if (!command || typeof command !== "object") {
                continue;
            }
            const write = command as { entityKey?: unknown };
            if (typeof write.entityKey !== "string") {
                continue;
            }
            if (!Object.prototype.hasOwnProperty.call(changeSet.readSet, write.entityKey)) {
                return true;
            }
        }
        return false;
    }

    private _lateResult(policy: TaskLatePolicy, reason: string): GateResult {
        switch (policy) {
            case TaskLatePolicy.Skip:
            case TaskLatePolicy.Compensate:
                return { decision: "expire", reason };
            case TaskLatePolicy.RunLate:
            case TaskLatePolicy.CatchUp:
                return { decision: "execute", reason: "迟到后补交" };
            default: {
                const neverPolicy: never = policy;
                return { decision: "expire", reason: String(neverPolicy) };
            }
        }
    }
}

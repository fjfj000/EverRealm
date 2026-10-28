import { ExecutionRecord, TaskChangeSet, TaskResultCommand } from "../task-contract";
import { EntityStore } from "./entity-store";
import { IdempotencyLedger } from "./idempotency-ledger";

export interface CommitJob {
    execution: ExecutionRecord;
    changeSet: TaskChangeSet;
    command?: TaskResultCommand;
}

/**
 * 全局唯一的短提交队列。
 * 临界区内禁止 await。异步等待不能占住这条队列。
 */
export class SerialCommitQueue {
    public constructor(
        private readonly _entities: EntityStore,
        private readonly _ledger: IdempotencyLedger
    ) {}

    public enqueue(job: CommitJob): void {
        this.apply(job.changeSet);
    }

    public apply(changeSet: TaskChangeSet): void {
        const sequence = this._ledger.nextCommitSequence();
        this._entities.apply(changeSet);
        this._ledger.record(changeSet.idempotencyKey, sequence);
    }

    public flush(): void {}
}

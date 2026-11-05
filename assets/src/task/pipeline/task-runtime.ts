import { GameTime, TaskChangeSet, TaskRecord } from "../task-contract";

/**
 * 任务处理函数。引擎只传入任务记录和当前游戏时间，不传入 external。
 * 函数不进存档。读档后要按任务 type 重新绑定，否则重发时找不到它。
 * 函数里不能再推进时钟。返回值里的 executionId 和幂等键会被换成这次执行自己的。
 *
 * 同步任务：返回值会提交。
 * 要改世界时，先读实体的当前值和版本，再返回 TaskChangeSet。
 * readSet 写读到的版本，commands 写计算后的新总值。有写入却没有对应读集，提交会被拒绝。
 * 版本冲突时引擎会再调用一次，必须按当时读到的数值重算，不能交回旧结果。
 * 这次不改世界就什么都不返回。
 * 还要再跑时，返回前把 task.nextSettleAt 改成更晚的时刻。不改则成功后任务结束。
 * 不要调用 issue 或 complete。
 *
 * 异步任务：返回值不提交，只负责发起外部工作。
 * 找到这条任务当前 Waiting 的执行，调用 external.issue，把返回的单号交给外部系统，然后返回。
 * 不要在同一次调用里 complete。不要自己保存或拼接单号。
 * Retry 或 Reissue 时引擎会再次调用本函数，仍然只调用 issue。沿用还是换号由 ExternalWork 决定。
 * 回包不在本函数里。外部结束时，由收到结果的代码用同一个单号调用 complete 或 fail。
 * 成功且没有要写的数据可以不带载荷。要改世界时，载荷必须带 readSet 和 commands，形状不对会使这次执行失败。
 * 真正写入发生在下一次安全点，检查规则与同步任务相同。
 * UseRecordedResult 不调用本函数，只消费事先放进收件箱的结果。
 * 补偿不是本函数的分支。策略为 Compensate 时，引擎调用按 type 登记的补偿函数。
 */
export type TaskHandler = (task: TaskRecord, now: GameTime) => TaskChangeSet | void;

/**
 * 补偿处理函数。只在 Compensate 时调用，必须同步返回。
 * 读当前实体并写入新总值，幂等键由引擎定为「执行编号#compensate」。
 * 返回空表示没有要写的数据，引擎仍会记键，避免下次再补偿一次。
 * 不要调用 issue 或 complete，不要在这里推进时钟。
 */
export type TaskCompensationHandler = TaskHandler;

/** 运行期处理器和序号。不放进可存档的 TaskRecord。 */
export class TaskRuntime {
    private readonly _handlers: Map<string, TaskHandler> = new Map();
    /** 按任务编号登记的补偿函数。不进存档。 */
    private readonly _compensations: Map<string, TaskCompensationHandler> = new Map();
    private _sequence: number = 1;

    public nextSequence(): number {
        const sequence = this._sequence;
        this._sequence += 1;
        return sequence;
    }

    public peekSequence(): number {
        return this._sequence;
    }

    public restoreSequence(value: number): void {
        if (!Number.isInteger(value) || value < 1) {
            throw new Error("任务序号必须是正整数");
        }
        this._sequence = value;
    }

    public setHandler(taskId: string, handler: TaskHandler): void {
        this._handlers.set(taskId, handler);
    }

    public handler(taskId: string): TaskHandler | undefined {
        return this._handlers.get(taskId);
    }

    public setCompensation(taskId: string, handler: TaskCompensationHandler): void {
        this._compensations.set(taskId, handler);
    }

    public compensation(taskId: string): TaskCompensationHandler | undefined {
        return this._compensations.get(taskId);
    }

    public remove(taskId: string): void {
        this._handlers.delete(taskId);
        this._compensations.delete(taskId);
    }

    public clear(): void {
        this._handlers.clear();
        this._compensations.clear();
        this._sequence = 1;
    }
}

export enum TaskState {
    /** 任务初始状态 */
    None = 0,
    /** 任务准备好可以执行 */
    Ready = 1,
    /** 任务执行中 */
    Running = 2,
    /** 任务执行完成 */
    Completed = 3,
    /** 任务执行失败 */
    Failed = 4,
    /** 任务执行取消 */
    Canceled = 5,
    /** 任务执行暂停 */
    Paused = 6,
    /** 任务删除 */
    Dead = 7,
}

export enum TaskBlockType {
    /** 阻塞任务 */
    Block = 0,
    /** 非阻塞任务 */
    NonBlock = 1,
}

/** 任务重复类型 */
export enum TaskRepeatType {
    /** 任务不重复执行 */
    Once = 0,
    /** 任务重复执行 */
    Repeat = 1,
    /** 任务无限重复执行 */
    Infinite = 2,
}

export enum TaskSequenceType {
    /** 资源结算序列 */
    ResourceSettlement = 0,
    /** 战斗结算序列 */
    BattleSettlement = 1,
    /** 剧情序列 */
    Story = 2,
    /** 任务序列 */
    Task = 3,
    /** 系统序列 */
    System = 4,
    /** 其他序列 */
    Other = 5,
}

export interface ITaskInfo {
    startTime: number;
    endTime: number;
    repeatType: TaskRepeatType;
    repeatCount: number;
    sequenceType: TaskSequenceType | number;
    blockType: TaskBlockType;
    priority: number;
    callback: (...args: any[]) => void;
}

/** 只用来从 StartTime 计算下一次 nextSettleAt，不是执行队列。 */
export enum TaskSettleLevel {
    Minute = 0,
    Hour = 1,
    Day = 2,
    MultiDay = 3,
    Month = 4,
    Year = 5,
}

/** handler 同步返回，还是外部结果稍后回流。 */
export enum TaskExecutionMode {
    Sync = 0,
    Async = 1,
}

/** 是否暂停世界时间。异步等待本身不停时钟。 */
export enum TaskTimePolicy {
    ContinueWorld = 0,
    PauseWorld = 1,
}

/** 外部结果与后续世界之间的因果关系。 */
export enum TaskCausalityPolicy {
    /** 结果不影响等待期间已经推进的世界。时钟不因这次等待停下。 */
    Independent = 0,
    /** 结果提交前，时钟停在发起这一秒。 */
    StopWorldUntilResult = 1,
    /** 时钟继续走。结果晚到后仍按 commitBefore 和迟到策略决定能否提交。 */
    AllowLateResult = 2,
    /** 不调用处理函数，也不访问外部服务。消费已经录好的结果。 */
    UseRecordedResult = 3,
}

/** 错过 startBefore 或 commitBefore 后的处理。 */
export enum TaskLatePolicy {
    Skip = 0,
    RunLate = 1,
    CatchUp = 2,
    /** 不执行原变更。若登记了补偿函数，先提交补偿，再结束。 */
    Compensate = 3,
}

/** 同一 Task 上一次 execution 尚未结束时，下一次边界怎么处理。 */
export enum TaskOverlapPolicy {
    Coalesce = 0,
    Queue = 1,
    Skip = 2,
    Parallel = 3,
}

/** activeUntil 前不足一个完整周期时怎么结算。 */
export enum TaskPartialSettlementPolicy {
    Proportional = 0,
    Drop = 1,
    SettleOnceAtEnd = 2,
}

/** 外部请求超时或读档后怎么处理。不保存 Promise。 */
export enum TaskAsyncRecoveryPolicy {
    /** 再次询问同一张外部单。次数达到 maxAttempts 后改为失败并释放资源。 */
    Retry = 0,
    /** 作废旧单，再发一张新的外部单。次数限制和 Retry 相同。 */
    Reissue = 1,
    /** 不重新发起。超时后释放资源，执行继续等待，迟到结果仍可提交。 */
    QueryRemote = 2,
    /** 取消这次执行和所属任务，并释放资源。 */
    Cancel = 3,
    /** 不提交原结果。若登记了补偿函数，先提交补偿变更，再结束执行并释放资源。 */
    Compensate = 4,
}

/** 资源声明决定互斥范围，TaskSequenceType 不承担这个职责。 */
export enum TaskResourceAccess {
    Read = 0,
    Write = 1,
    Exclusive = 2,
}

/** 整条任务的状态。一次执行的状态看 TaskExecutionStatus。 */
export enum TaskLifecycleState {
    /** 已登记，还没开始。到 nextSettleAt 才会被取出。 */
    Scheduled = 0,
    /** 已经开始。异步还在等待，或同步完成后又排了下一次。 */
    Active = 1,
    /** 没有未完成的执行，也不再排下一次。 */
    Completed = 2,
    /** 被主动取消或按取消策略结束。之后的触发都会跳过。 */
    Canceled = 3,
    /** 错过时限、活动 revision 失效、末段被丢弃，或处理函数抛错。之后的触发都会跳过。 */
    Expired = 4,
}

/** 完成、取消、失效之后标记为【终止状态】，该状态不可逆 */
export function isTerminalLifecycle(state: TaskLifecycleState): boolean {
    switch (state) {
        case TaskLifecycleState.Completed:
        case TaskLifecycleState.Canceled:
        case TaskLifecycleState.Expired:
            return true;
        case TaskLifecycleState.Scheduled:
        case TaskLifecycleState.Active:
            return false;
        default: {
            const neverState: never = state;
            void neverState;
            return true;
        }
    }
}

/** 一次执行的状态。一条任务可以同时有多条执行。 */
export enum TaskExecutionStatus {
    /** 已经生成，还没开始。 */
    Ready = 0,
    /** 同步处理函数正在跑，或异步执行刚创建、尚未进入等待。 */
    Running = 1,
    /** 外部结果还没回来。调度器已经让出，资源按声明继续占用。 */
    Waiting = 2,
    /** 变更已经准备好，还没进入提交。 */
    Prepared = 3,
    /** 正在串行提交。这段里面不能等待外部结果。 */
    Committing = 4,
    /** 提交成功。 */
    Completed = 5,
    /** 处理函数抛错、提交被拒绝，或外部结果失败。 */
    Failed = 6,
    /** 被主动取消或按取消策略结束。资源已释放。 */
    Canceled = 7,
    /** 错过开始或提交时限，或按补偿策略结束。 */
    Expired = 8,
    /** 这次触发被跳过，没有启动。 */
    Skipped = 9,
}

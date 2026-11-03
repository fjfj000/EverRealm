import {
    TaskAsyncRecoveryPolicy,
    TaskCausalityPolicy,
    TaskExecutionMode,
    TaskExecutionStatus,
    TaskLatePolicy,
    TaskLifecycleState,
    TaskOverlapPolicy,
    TaskPartialSettlementPolicy,
    TaskResourceAccess,
    TaskSequenceType,
    TaskSettleLevel,
    TaskTimePolicy,
} from "./task-define";

/** 游戏内计时，调度和结算都以它为准。目标实现使用整数定点。 */
export type GameTime = number;

export interface TaskResourceClaim {
    resourceKey: string;
    access: TaskResourceAccess;
}

/** 任务主记录，时间索引由它重建。一次任务可以对应多次 ExecutionRecord。 */
export interface TaskRecord {
    /** 任务编号。执行编号由它、结算时刻和 revision 拼出。 */
    id: string;
    /** 任务种类。读档后按这个字段重新绑定处理函数，函数本身不进存档。 */
    type: string;
    /** 周期起点。用来推算周期长度，不是时间表的分槽键。 */
    startTime: GameTime;
    /** 下一次结算时刻，时间表按它分槽。新登记时若已经早于当前时间，由开始迟到策略决定失效或补跑。完成后若要再跑，必须改成更晚的时刻再插回索引。 */
    nextSettleAt: GameTime;
    /** 最早可以开始准备的时刻。当前索引用 nextSettleAt；末段推迟时会把它改成同一时刻。 */
    dueAt: GameTime;
    /** 最晚可以真正开始的时刻。不填时，晚于 nextSettleAt 即算错过。 */
    startBefore?: GameTime;
    /** 最晚可以提交结果的时刻。晚于它则按 commitLatePolicy 处理。 */
    commitBefore?: GameTime;
    /** 任务效果结束的时刻。早于 nextSettleAt 时，末段按 partialSettlementPolicy 结算。 */
    activeUntil?: GameTime;
    /** 周期档位，只用来算下一次间隔，不决定执行队列。 */
    settleLevel: TaskSettleLevel;
    /** MultiDay 的间隔天数。其他档位不使用。 */
    cadenceParam?: number;
    /** 同一时刻的阶段顺序。数字小的先执行，不表示互斥。 */
    sequenceType: TaskSequenceType;
    /** 同一阶段内的优先级。数字小的先执行。 */
    priority: number;
    /** 同一优先级内的稳定序号。数字小的先执行。 */
    sequence: number;
    /** 处理函数当场返回，还是外部结果稍后回流。 */
    executionMode: TaskExecutionMode;
    /** ContinueWorld 不挡时钟。PauseWorld 停在这一秒，直到 resumeAfterDecision。 */
    timePolicy: TaskTimePolicy;
    /** 外部结果没回来时，后续世界能否继续。StopWorldUntilResult 会立起因果屏障。 */
    causalityPolicy: TaskCausalityPolicy;
    /** 显式资源占用。读可以并存，写和独占会挡住其他访问。 */
    resourceClaims: TaskResourceClaim[];
    /** 必须先完成的执行编号。不填时间先后，只认这些编号。 */
    dependsOn: string[];
    /** 额外的独占名额。实现里当成一把独占资源，键名是 serial: 加这个值。 */
    serialKey?: string;
    /** 错过 startBefore 之后：跳过、照常补跑、补跑或补偿。 */
    startLatePolicy: TaskLatePolicy;
    /** 错过 commitBefore 之后的处理，取值和 startLatePolicy 相同。 */
    commitLatePolicy: TaskLatePolicy;
    /** activeUntil 之前凑不满一个周期时：按比例、丢弃，或改到 activeUntil 再结算一次。 */
    partialSettlementPolicy: TaskPartialSettlementPolicy;
    /** 上一次执行还没结束、下一次边界又到了：合并、排队、跳过或并行。 */
    overlapPolicy: TaskOverlapPolicy;
    /** 外部请求超时或读档后：重试、再发、继续等、取消或补偿。 */
    asyncRecoveryPolicy: TaskAsyncRecoveryPolicy;
    /** 业务自己的数据。引擎不解释，存档时按 JSON 保存。 */
    payload: unknown;
    /** 整条任务的状态。一次执行的状态在 ExecutionRecord 上。 */
    lifecycleState: TaskLifecycleState;
    /** 任务内容版本。外部结果带回的 revision 必须和它一致，否则拒绝提交。 */
    revision: number;
    /** 关联活动。结算时必须和活动当前 revision 一致。 */
    activityId?: string;
    /** 登记任务时看到的活动版本。活动被改道或取消后会加一，旧任务随之过期。 */
    activityRevision?: number;
    /** 从触发时刻起，超过这么多游戏秒仍未回流就按恢复策略处理。 */
    timeoutGameSeconds?: number;
    /** Retry / Reissue 的次数上限。缺省为 3。 */
    maxAttempts?: number;
    /** 末段不足一个周期时算出的比例。只在延迟到 activeUntil 再结算时使用。 */
    partialRatio?: number;
}

/** 一次到期机会。Ready、Waiting、提交都挂在这条记录上。 */
export interface ExecutionRecord {
    executionId: string;
    taskId: string;
    taskRevision: number;
    triggerAt: GameTime;
    settleIntervalFrom: GameTime;
    settleIntervalTo: GameTime;
    status: TaskExecutionStatus;
    priority: number;
    sequence: number;
    /** 处理函数已调用的次数，含首次。Reissue 用它区分新单，Retry 不换单号。 */
    attempt: number;
    acquiredResources: string[];
    readSet: Record<string, number>;
    preparedResult?: unknown;
    recoveryPolicy: TaskAsyncRecoveryPolicy;
    idempotencyKey: string;
    timeoutAt?: GameTime;
    externalCorrelationId?: string;
    /** 末段不足周期时的结算比例。完整周期为 1。 */
    partialRatio?: number;
}

/** 交给调度器的一次执行请求，不直接代表 Task 生命周期。 */
export interface TaskExecutionRequest {
    execution: ExecutionRecord;
    task: TaskRecord;
}

/**
 * 外部结果入队时的记录。
 * 入队只追加这条记录，不改世界，也不推进时钟。安全点再按 commandSequence 提交。
 */
export interface TaskResultCommand {
    /** 入队时分配的编号，格式是 result:序号。 */
    commandId: string;
    /** 单调递增的提交顺序。不使用墙上时间排序。 */
    commandSequence: number;
    /** 这条结果属于哪一次执行。对不上就丢弃。 */
    executionId: string;
    /** 所属任务。 */
    taskId: string;
    /** 入队时看到的任务 revision。和当前任务不一致就拒绝提交。 */
    taskRevision: number;
    /** 外部请求自己的关联号，由 ExternalWork 填入。 */
    externalCorrelationId?: string;
    /** 安全点接收时的游戏时间。刚入队时还是 0。 */
    acceptedAtGameTime: GameTime;
    /** 外部完成的真实时间，只供诊断，不参与排序。 */
    completedAtRealTime: number;
    /** 外部工作是否成功。失败只结束执行，不应用 payload。 */
    success: boolean;
    /** 成功时带回的变更。可以是带 readSet 的 TaskChangeSet。 */
    payload?: unknown;
    /** 失败原因。success 为 false 时使用。 */
    errorCode?: string;
    /** 重复回流时用来保证只提交一次。缺省等于 executionId。 */
    idempotencyKey: string;
}

export interface TaskChangeSet {
    executionId: string;
    readSet: Record<string, number>;
    commands: unknown[];
    idempotencyKey: string;
}

/** 提交时写进实体表的一条数值。读集版本不符就不会应用。 */
export interface TaskEntityWrite {
    entityKey: string;
    value: number;
}

/** 同一次触发的执行编号。依赖方用它等待，不使用墙上时间。 */
export function makeExecutionId(taskId: string, settleAt: GameTime, revision: number): string {
    return `${taskId}:${settleAt}:${revision}`;
}

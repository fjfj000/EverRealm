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
    id: string;
    type: string;
    startTime: GameTime;
    nextSettleAt: GameTime;
    dueAt: GameTime;
    startBefore?: GameTime;
    commitBefore?: GameTime;
    activeUntil?: GameTime;
    settleLevel: TaskSettleLevel;
    cadenceParam?: number;
    sequenceType: TaskSequenceType;
    priority: number;
    sequence: number;
    executionMode: TaskExecutionMode;
    timePolicy: TaskTimePolicy;
    causalityPolicy: TaskCausalityPolicy;
    resourceClaims: TaskResourceClaim[];
    dependsOn: string[];
    serialKey?: string;
    startLatePolicy: TaskLatePolicy;
    commitLatePolicy: TaskLatePolicy;
    partialSettlementPolicy: TaskPartialSettlementPolicy;
    overlapPolicy: TaskOverlapPolicy;
    asyncRecoveryPolicy: TaskAsyncRecoveryPolicy;
    payload: unknown;
    lifecycleState: TaskLifecycleState;
    revision: number;
    /** 关联活动。结算时必须和活动当前 revision 一致。 */
    activityId?: string;
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

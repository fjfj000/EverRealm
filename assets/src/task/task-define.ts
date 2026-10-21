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

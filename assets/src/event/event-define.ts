export enum EventState {
    /** 事件初始状态 */
    None = 0,
    /** 事件准备好可以执行 */
    Ready = 1,
    /** 事件执行中 */
    Running = 2,
    /** 事件执行完成 */
    Completed = 3,
    /** 事件执行失败 */
    Failed = 4,
    /** 事件执行取消 */
    Canceled = 5,
    /** 事件执行暂停 */
    Paused = 6,
    /** 事件删除 */
    Dead = 7,
}

export enum EventBlockType {
    /** 阻塞事件 */
    Block = 0,
    /** 非阻塞事件 */
    NonBlock = 1,
}

/** 事件重复类型 */
export enum EventRepeatType {
    /** 事件不重复执行 */
    Once = 0,
    /** 事件重复执行 */
    Repeat = 1,
    /** 事件无限重复执行 */
    Infinite = 2,
}

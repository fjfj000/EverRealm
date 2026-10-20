export enum EventState {
    /** 事件未执行 */
    None = 0,
    /** 事件执行中 */
    Running = 1,
    /** 事件执行完成 */
    Completed = 2,
    /** 事件执行失败 */
    Failed = 3,
    /** 事件执行取消 */
    Canceled = 4,
    /** 事件执行暂停 */
    Paused = 5,
    /** 事件执行恢复 */
    Resumed = 6,
}

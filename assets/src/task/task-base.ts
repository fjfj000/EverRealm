import { IdType } from "../framwork/id/id-define";
import { PropertyObserver } from "../framwork/observer/property-observer";
import {
    ITaskInfo,
    TaskBlockType,
    TaskRepeatType,
    TaskSequenceType,
    TaskState,
} from "./task-define";

export class TaskBase extends PropertyObserver {
    /**
     * 目前任务统一用 IdType.Task。更细的 idType 后续再补，子类覆盖这个方法即可。
     */
    protected getIdType(): IdType {
        return IdType.Task;
    }

    /** 任务优先级。数字小的先执行。 */
    private _priority: number = 0;
    public get Priority(): number {
        return this._priority;
    }
    public set Priority(value: number) {
        this._priority = value;
    }

    /** 任务状态 */
    private _state: TaskState = TaskState.None;
    public get State(): TaskState {
        return this._state;
    }
    public set State(value: TaskState) {
        const beforeState = this._state;
        if (beforeState === value) {
            return;
        }
        this._state = value;
        // 事件名是 `${Id}_${TaskState}`，TaskState 用枚举值，参数是变更前、变更后。
        // 必须在本次赋值返回前同步发出。外部把状态改成 Dead 后就会摘掉任务，晚发就听不到这次删除。
        this.emit(this._stateEventName(value), beforeState, value);
    }

    private _callback: (...args: any[]) => void;
    public constructor(info: ITaskInfo) {
        super();
        this.startTime = info.startTime;
        this._nextSettleAt = info.startTime;
        this.endTime = info.endTime;
        this._repeatType = info.repeatType;
        this._repeatCount = info.repeatCount;
        this._sequenceType = info.sequenceType;
        this._blockType = info.blockType;
        this._priority = info.priority;
        this._callback = info.callback;
    }

    /** 调度器在提交通过后调用。回调不负责推进世界时间。 */
    public run(now: number): void {
        this._callback(now);
    }

    /**
     * 监听进入某个状态。
     * 事件名由任务 Id 拼出来，调用处只选状态，afterState 会收窄到这一个枚举值。
     * Id 在运行时才生成，完整事件名做不成编译期字面量提示。
     */
    public on_state<State extends TaskState>(
        state: State,
        listener: (beforeState: TaskState, afterState: State) => void
    ): void {
        this.on(this._stateEventName(state), listener);
    }

    /**
     * 注销状态监听。
     * 传入 listener 时只移除这一条；不传则移除该状态的全部监听。
     */
    public off_state<State extends TaskState>(
        state: State,
        listener?: (beforeState: TaskState, afterState: State) => void
    ): void {
        this.off(this._stateEventName(state), listener);
    }

    /** `${Id}_${TaskState}` */
    private _stateEventName(state: TaskState): string {
        return `${this.Id}_${state}`;
    }

    /** 任务序列类型 */
    private _sequenceType: TaskSequenceType | number = TaskSequenceType.Other;
    public get SequenceType(): TaskSequenceType | number {
        return this._sequenceType;
    }
    public set SequenceType(value: TaskSequenceType | number) {
        this._sequenceType = value;
    }

    /** 任务阻塞类型 */
    private _blockType: TaskBlockType = TaskBlockType.NonBlock;
    public get BlockType(): TaskBlockType {
        return this._blockType;
    }
    public set BlockType(value: TaskBlockType) {
        this._blockType = value;
    }

    /** 下一次调度时间。周期任务完成后往后推，不改 StartTime。 */
    private _nextSettleAt: number = 0;
    public get NextSettleAt(): number {
        return this._nextSettleAt;
    }
    public set NextSettleAt(value: number) {
        this._nextSettleAt = value;
    }

    /** 同优先级下的稳定序号。数字小的先执行。 */
    private _sequence: number = 0;
    public get Sequence(): number {
        return this._sequence;
    }
    public set Sequence(value: number) {
        this._sequence = value;
    }

    /** 任务开始时间 */
    private startTime: number = 0;
    public get StartTime(): number {
        return this.startTime;
    }
    public set StartTime(value: number) {
        this.startTime = value;
    }

    /** 任务结束时间 */
    private endTime: number = 0;
    public get EndTime(): number {
        return this.endTime;
    }
    public set EndTime(value: number) {
        this.endTime = value;
    }

    /** 任务重复类型 */
    private _repeatType: TaskRepeatType = TaskRepeatType.Once;
    public get RepeatType(): TaskRepeatType {
        return this._repeatType;
    }
    public set RepeatType(value: TaskRepeatType) {
        this._repeatType = value;
    }
    /** 任务重复次数 */
    private _repeatCount: number = 0;
    public get RepeatCount(): number {
        return this._repeatCount;
    }
    public set RepeatCount(value: number) {
        this._repeatCount = value;
    }
}

import { IdType } from "../framwork/id/id-define";
import { PropertyObserver } from "../framwork/observer/property-observer";
import { TaskBlockType, TaskRepeatType, TaskSequenceType, TaskState } from "./task-define";

export class TaskBase extends PropertyObserver {
    /**
     * 目前任务统一用 IdType.Task。更细的 idType 后续再补，子类覆盖这个方法即可。
     */
    protected getIdType(): IdType {
        return IdType.Task;
    }

    /** 任务优先级，数值越大优先级越高，越先执行 */
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
        this._state = value;
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

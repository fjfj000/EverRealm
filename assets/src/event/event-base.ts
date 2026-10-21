import { IdType } from "../framwork/id/id-define";
import { PropertyObserver } from "../framwork/observer/property-observer";
import { EventBlockType, EventRepeatType, EventState } from "./event-define";

export class EventBase extends PropertyObserver {
    /**
     * 目前事件统一用 IdType.Event。更细的 idType 后续再补，子类覆盖这个方法即可。
     */
    protected getIdType(): IdType {
        return IdType.Event;
    }

    /** 事件优先级，数值越大优先级越高，越先执行 */
    private _priority: number = 0;
    public get Priority(): number {
        return this._priority;
    }
    public set Priority(value: number) {
        this._priority = value;
    }

    /** 事件状态 */
    private _state: EventState = EventState.None;
    public get State(): EventState {
        return this._state;
    }
    public set State(value: EventState) {
        this._state = value;
    }

    /** 事件阻塞类型 */
    private _blockType: EventBlockType = EventBlockType.NonBlock;
    public get BlockType(): EventBlockType {
        return this._blockType;
    }
    public set BlockType(value: EventBlockType) {
        this._blockType = value;
    }

    /** 事件开始时间 */
    private startTime: number = 0;
    public get StartTime(): number {
        return this.startTime;
    }
    public set StartTime(value: number) {
        this.startTime = value;
    }

    /** 事件结束时间 */
    private endTime: number = 0;
    public get EndTime(): number {
        return this.endTime;
    }
    public set EndTime(value: number) {
        this.endTime = value;
    }

    /** 事件重复类型 */
    private _repeatType: EventRepeatType = EventRepeatType.Once;
    public get RepeatType(): EventRepeatType {
        return this._repeatType;
    }
    public set RepeatType(value: EventRepeatType) {
        this._repeatType = value;
    }
    /** 事件重复次数 */
    private _repeatCount: number = 0;
    public get RepeatCount(): number {
        return this._repeatCount;
    }
    public set RepeatCount(value: number) {
        this._repeatCount = value;
    }
}

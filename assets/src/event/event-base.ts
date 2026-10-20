export class EventBase {
    /** 事件优先级，数值越大优先级越高，越先执行 */
    private _priority: number = 0;
    public get Priority(): number {
        return this._priority;
    }
    public set Priority(value: number) {
        this._priority = value;
    }

    private _state: boolean = true;
}

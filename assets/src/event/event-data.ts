export class EventData {
    /** 事件ID */
    private _id: string = "";
    public get Id(): string {
        return this._id;
    }
    public set Id(value: string) {
        this._id = value;
    }
}

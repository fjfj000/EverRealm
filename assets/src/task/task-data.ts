export class TaskData {
    /** 任务ID */
    private _id: string = "";
    public get Id(): string {
        return this._id;
    }
    public set Id(value: string) {
        this._id = value;
    }
}

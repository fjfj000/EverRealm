import { setInstance } from "../framwork/utils/instance";
import { GameTime } from "../task/task-contract";
import { ActivityRecord } from "./activity-record";

/** 行军、围城、训练、拜访等持续过程的生命周期。队列只保存它们的下一边界。 */
@setInstance
export class ActivityManager {
    private readonly _records: Map<string, ActivityRecord> = new Map();

    public create(record: ActivityRecord): void {
        this._records.set(record.id, { ...record });
    }

    public get(activityId: string): ActivityRecord | undefined {
        const record = this._records.get(activityId);
        if (!record) {
            return undefined;
        }
        return { ...record };
    }

    /** 改道、取消或完成时递增 revision，使旧边界在结算前失效。 */
    public bumpRevision(activityId: string, _now: GameTime): number {
        const record = this._records.get(activityId);
        if (!record) {
            return 0;
        }
        record.revision += 1;
        return record.revision;
    }

    public list(): ActivityRecord[] {
        return Array.from(this._records.values()).map((record) => ({ ...record }));
    }

    public restore(records: readonly ActivityRecord[]): void {
        this._records.clear();
        for (const record of records) {
            this._records.set(record.id, { ...record });
        }
    }

    public reset(): void {
        this._records.clear();
    }
}

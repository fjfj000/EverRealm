import { Instance } from "../../framwork/utils/instance";
import { TaskLifecycleState } from "../task-define";
import { TaskRecord } from "../task-contract";
import { ActivityManager } from "../../world/activity-manager";

export type GateDecision = "execute" | "skip" | "expire" | "reschedule";

export interface GateResult {
    decision: GateDecision;
    reason: string;
}

/** 从时间索引取出时过滤取消、完成和尚未到期的任务。 */
export class TriggerGate {
    public check(task: TaskRecord, settleAt: number): GateResult {
        if (
            task.lifecycleState === TaskLifecycleState.Canceled ||
            task.lifecycleState === TaskLifecycleState.Completed ||
            task.lifecycleState === TaskLifecycleState.Expired
        ) {
            return { decision: "skip", reason: "任务已结束" };
        }
        if (task.nextSettleAt > settleAt && !(task.activeUntil !== undefined && task.activeUntil <= settleAt)) {
            return { decision: "skip", reason: "还没到触发时间" };
        }
        if (task.activityId) {
            const activity = (Instance(ActivityManager) as ActivityManager).get(task.activityId);
            if (!activity || activity.revision !== task.activityRevision) {
                return { decision: "skip", reason: "活动 revision 已变化" };
            }
        }
        return { decision: "execute", reason: "到期" };
    }
}

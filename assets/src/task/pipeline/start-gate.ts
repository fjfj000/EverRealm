import { TaskRecord } from "../task-contract";
import { TaskLatePolicy } from "../task-define";
import { GateResult } from "./trigger-gate";

/**
 * 真正启动前检查 startBefore。
 * 等于截止时间仍然允许开始。更晚则按迟到策略处理。
 */
export class StartGate {
    public check(task: TaskRecord, now: number): GateResult {
        const missedStart = task.startBefore !== undefined ? now > task.startBefore : now > task.nextSettleAt;
        if (!missedStart) {
            return { decision: "execute", reason: "可以开始" };
        }
        return this._lateResult(task.startLatePolicy);
    }

    private _lateResult(policy: TaskLatePolicy): GateResult {
        switch (policy) {
            case TaskLatePolicy.Skip:
            case TaskLatePolicy.Compensate:
                return { decision: "expire", reason: "已经超过最晚开始时间" };
            case TaskLatePolicy.RunLate:
            case TaskLatePolicy.CatchUp:
                return { decision: "execute", reason: "迟到后补跑" };
            default: {
                const neverPolicy: never = policy;
                return { decision: "expire", reason: String(neverPolicy) };
            }
        }
    }
}

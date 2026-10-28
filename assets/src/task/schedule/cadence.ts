import { TaskRecord } from "../task-contract";
import { TaskPartialSettlementPolicy, TaskSettleLevel } from "../task-define";
import { GameTimeUnit } from "../../framwork/utils/date-utils";

/** 这一档结算覆盖的游戏秒数。只根据 StartTime 的节奏推算，不是执行队列。 */
export function cadenceSeconds(task: TaskRecord): number {
    switch (task.settleLevel) {
        case TaskSettleLevel.Minute:
            return GameTimeUnit.minute;
        case TaskSettleLevel.Hour:
            return GameTimeUnit.hour;
        case TaskSettleLevel.Day:
            return GameTimeUnit.day;
        case TaskSettleLevel.MultiDay:
            return GameTimeUnit.day * Math.max(1, task.cadenceParam ?? 1);
        case TaskSettleLevel.Month:
            return GameTimeUnit.month;
        case TaskSettleLevel.Year:
            return GameTimeUnit.year;
        default: {
            const neverLevel: never = task.settleLevel;
            void neverLevel;
            return GameTimeUnit.minute;
        }
    }
}

export type PartialDecision =
    | { kind: "full" }
    | { kind: "drop" }
    | { kind: "defer"; at: number; ratio: number }
    | { kind: "partial"; ratio: number };

/**
 * 周期终点晚于 activeUntil 时，末段不是完整周期。
 * 比例按「本段起点到 activeUntil」占整个周期的多少来算。
 */
export function resolvePartial(task: TaskRecord): PartialDecision {
    if (task.activeUntil === undefined) {
        return { kind: "full" };
    }
    if (task.partialRatio !== undefined && task.nextSettleAt === task.activeUntil) {
        return { kind: "partial", ratio: task.partialRatio };
    }
    const period = cadenceSeconds(task);
    const segmentStart = task.nextSettleAt - period;
    if (task.activeUntil >= task.nextSettleAt) {
        return { kind: "full" };
    }
    if (task.activeUntil <= segmentStart) {
        return { kind: "drop" };
    }
    const ratio = (task.activeUntil - segmentStart) / period;
    switch (task.partialSettlementPolicy) {
        case TaskPartialSettlementPolicy.Drop:
            return { kind: "drop" };
        case TaskPartialSettlementPolicy.Proportional:
            return { kind: "partial", ratio };
        case TaskPartialSettlementPolicy.SettleOnceAtEnd:
            if (task.nextSettleAt !== task.activeUntil) {
                return { kind: "defer", at: task.activeUntil, ratio };
            }
            return { kind: "partial", ratio };
        default: {
            const neverPolicy: never = task.partialSettlementPolicy;
            void neverPolicy;
            return { kind: "drop" };
        }
    }
}

import { TaskRecord } from "../task-contract";

/** 数字小的 priority、sequence 先执行。时间键相同才比较后面的字段。 */
export function compareTaskRecord(left: TaskRecord, right: TaskRecord): number {
    if (left.nextSettleAt !== right.nextSettleAt) {
        return left.nextSettleAt - right.nextSettleAt;
    }
    if (left.sequenceType !== right.sequenceType) {
        return left.sequenceType - right.sequenceType;
    }
    if (left.priority !== right.priority) {
        return left.priority - right.priority;
    }
    if (left.sequence !== right.sequence) {
        return left.sequence - right.sequence;
    }
    if (left.id === right.id) {
        return 0;
    }
    return left.id < right.id ? -1 : 1;
}

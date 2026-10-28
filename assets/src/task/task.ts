import { TaskBase } from "./task-base";
import { ITaskInfo, TaskBlockType, TaskRepeatType, TaskSequenceType } from "./task-define";

const EMPTY_TASK_INFO: ITaskInfo = {
    startTime: 0,
    endTime: 0,
    repeatType: TaskRepeatType.Once,
    repeatCount: 0,
    sequenceType: TaskSequenceType.Other,
    blockType: TaskBlockType.NonBlock,
    priority: 0,
    callback: () => undefined,
};

export class Task extends TaskBase {
    constructor(info: ITaskInfo = EMPTY_TASK_INFO) {
        super(info);
    }
}

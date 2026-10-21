import MinHeap from "../framwork/data_structures/min_heap";
import { TaskBase } from "./task-base";

export class TaskSequence {
    private _tasks: MinHeap<TaskBase>;

    constructor() {
        this._tasks = new MinHeap<TaskBase>([], this._compareTask);
    }

    /** 任务排序 */
    private _compareTask(a: TaskBase, b: TaskBase): number {
        if (a.StartTime !== b.StartTime) {
            return a.StartTime - b.StartTime;
        }
        if (a.SequenceType !== b.SequenceType) {
            return a.SequenceType - b.SequenceType;
        }
        return a.Priority - b.Priority;
    }

    public addTask(task: TaskBase): void {
        this._tasks.push(task);
    }

    public removeTask(task: TaskBase): void {
        let index = this._tasks.indexOf(task);
        if (index !== -1) {
            this._tasks.delete(index);
        }
    }
}

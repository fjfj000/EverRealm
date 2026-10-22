import { setInstance } from "../framwork/utils/instance";
import { TaskBase } from "./task-base";

@setInstance
export class TaskManager {
    private _tasks: TaskBase[] = [];
}

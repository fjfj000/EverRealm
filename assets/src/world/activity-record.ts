import { GameTime } from "../task/task-contract";

/** 持续过程的主记录。预计结束时间不是调度键。 */
export interface ActivityRecord {
    id: string;
    type: string;
    revision: number;
    startedAt: GameTime;
    expectedEndAt?: GameTime;
    state: "active" | "completed" | "failed" | "canceled";
}

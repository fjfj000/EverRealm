import { GameTime, TaskRecord, TaskResultCommand, ExecutionRecord } from "../task/task-contract";
import { ActivityRecord } from "./activity-record";

/** 一次可恢复的存档。运行时直址表、Promise 和回调不写进来。 */
export interface GameSaveDto {
    schemaVersion: 1;
    world: {
        currentTime: GameTime;
        timeSpeed: number;
        enableTick: boolean;
        realToGameRemainder: number;
        pendingTarget: number | null;
        holdWorld: boolean;
        decisionPaused: boolean;
        nextEntitySequence: number;
    };
    taskSystem: {
        nextTaskSequence: number;
        nextCommandSequence: number;
        nextCommitSequence: number;
        tasks: TaskRecord[];
        executions: ExecutionRecord[];
        resultInbox: TaskResultCommand[];
        idempotency: { key: string; sequence: number }[];
        entities: { entityKey: string; version: number; value: number }[];
        activities: ActivityRecord[];
    };
}

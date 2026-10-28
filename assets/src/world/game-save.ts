import { peekNextSerial, restoreNextSerial } from "../framwork/id/id-generator";
import { Instance } from "../framwork/utils/instance";
import { TaskManager } from "../task/task-manager";
import { ActivityManager } from "./activity-manager";
import { WorldClock } from "./world-clock";
import { WorldDriver } from "./world-driver";
import { GameSaveDto } from "./save-dto";

/** 把时钟、换算余数、任务、执行、收件箱和幂等账本收成一份快照。 */
export function captureGame(): GameSaveDto {
    const clock = Instance(WorldClock) as WorldClock;
    const driver = Instance(WorldDriver) as WorldDriver;
    const tasks = Instance(TaskManager) as TaskManager;
    const activities = Instance(ActivityManager) as ActivityManager;
    const progress = driver.exportProgress();
    const pipeline = tasks.Pipeline.exportSnapshot();
    return clone({
        schemaVersion: 1,
        world: {
            currentTime: Math.floor(clock.TotalGameTime),
            timeSpeed: clock.TimeSpeed,
            enableTick: clock.EnableTick,
            realToGameRemainder: progress.remainder,
            pendingTarget: progress.pendingTarget,
            holdWorld: progress.holdWorld,
            decisionPaused: progress.decisionPaused,
            nextEntitySequence: peekNextSerial(),
        },
        taskSystem: {
            nextTaskSequence: pipeline.nextTaskSequence,
            nextCommandSequence: pipeline.nextCommandSequence,
            nextCommitSequence: pipeline.nextCommitSequence,
            tasks: tasks.records(),
            executions: pipeline.executions,
            resultInbox: pipeline.resultInbox,
            idempotency: pipeline.idempotency,
            entities: pipeline.entities,
            activities: activities.list(),
        },
    });
}

/** 忽略回调和墙钟时间后的状态摘要，用来对照分段推进和一次推进。 */
export function hashGameState(): string {
    const saved = captureGame();
    const summary = {
        time: saved.world.currentTime,
        remainder: saved.world.realToGameRemainder,
        pendingTarget: saved.world.pendingTarget,
        holdWorld: saved.world.holdWorld,
        decisionPaused: saved.world.decisionPaused,
        tasks: saved.taskSystem.tasks
            .map((task) => ({
                id: task.id,
                nextSettleAt: task.nextSettleAt,
                lifecycleState: task.lifecycleState,
                revision: task.revision,
            }))
            .sort((left, right) => (left.id < right.id ? -1 : 1)),
        executions: saved.taskSystem.executions
            .map((execution) => ({
                executionId: execution.executionId,
                status: execution.status,
                attempt: execution.attempt,
            }))
            .sort((left, right) => (left.executionId < right.executionId ? -1 : 1)),
        entities: saved.taskSystem.entities.slice().sort((left, right) => (left.entityKey < right.entityKey ? -1 : 1)),
        idempotency: saved.taskSystem.idempotency.slice().sort((left, right) => (left.key < right.key ? -1 : 1)),
        inbox: saved.taskSystem.resultInbox.map((command) => command.commandId).sort(),
        activities: saved.taskSystem.activities
            .map((activity) => ({ id: activity.id, revision: activity.revision, state: activity.state }))
            .sort((left, right) => (left.id < right.id ? -1 : 1)),
    };
    return fnv1a(JSON.stringify(summary));
}

/** 先摆钟，再按存档里的任务记录重建调度，并保留还没提交的外部结果。 */
export function restoreGame(saved: GameSaveDto): void {
    const clock = Instance(WorldClock) as WorldClock;
    const driver = Instance(WorldDriver) as WorldDriver;
    const tasks = Instance(TaskManager) as TaskManager;
    const activities = Instance(ActivityManager) as ActivityManager;
    const dto = clone(saved);
    clock.Load({
        totalGameTime: dto.world.currentTime,
        timeSpeed: dto.world.timeSpeed,
    });
    clock.EnableTick = dto.world.enableTick;
    restoreNextSerial(dto.world.nextEntitySequence);
    driver.importProgress({
        remainder: dto.world.realToGameRemainder,
        pendingTarget: dto.world.pendingTarget,
        holdWorld: dto.world.holdWorld,
        decisionPaused: dto.world.decisionPaused,
    });
    tasks.restore(dto.taskSystem.tasks, {
        nextTaskSequence: dto.taskSystem.nextTaskSequence,
        nextCommandSequence: dto.taskSystem.nextCommandSequence,
        nextCommitSequence: dto.taskSystem.nextCommitSequence,
        tasks: dto.taskSystem.tasks,
        executions: dto.taskSystem.executions,
        resultInbox: dto.taskSystem.resultInbox,
        idempotency: dto.taskSystem.idempotency,
        entities: dto.taskSystem.entities,
    }, dto.world.currentTime);
    activities.restore(dto.taskSystem.activities ?? []);
    tasks.rebindAndRecover(dto.world.currentTime);
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function fnv1a(text: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}

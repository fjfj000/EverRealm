import { peekNextSerial, restoreNextSerial } from "../assets/src/framwork/id/id-generator";
import { Instance } from "../assets/src/framwork/utils/instance";
import { makeExecutionId, TaskRecord } from "../assets/src/task/task-contract";
import { Task } from "../assets/src/task/task";
import { TaskManager } from "../assets/src/task/task-manager";
import {
    TaskAsyncRecoveryPolicy,
    TaskBlockType,
    TaskCausalityPolicy,
    TaskExecutionMode,
    TaskExecutionStatus,
    TaskLatePolicy,
    TaskLifecycleState,
    TaskOverlapPolicy,
    TaskPartialSettlementPolicy,
    TaskRepeatType,
    TaskResourceAccess,
    TaskSequenceType,
    TaskSettleLevel,
    TaskTimePolicy,
} from "../assets/src/task/task-define";
import { FUTURE_DAY_WINDOW } from "../assets/src/task/schedule/game-time";
import { ActivityManager } from "../assets/src/world/activity-manager";
import { captureGame, hashGameState, restoreGame } from "../assets/src/world/game-save";
import { AdvanceBudget, WorldDriver } from "../assets/src/world/world-driver";
import { WorldClock } from "../assets/src/world/world-clock";

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const BUDGET: AdvanceBudget = {
    maxBoundariesPerSlice: 100000,
    maxExecutionsPerSlice: 100000,
    maxMillisecondsPerSlice: 60000,
    maxSameTimeRounds: 100,
    maxSameTimeExecutions: 10000,
};

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

function boot(time: number = 0): { clock: WorldClock; driver: WorldDriver; tasks: TaskManager } {
    const clock = Instance(WorldClock) as WorldClock;
    const driver = Instance(WorldDriver) as WorldDriver;
    const tasks = Instance(TaskManager) as TaskManager;
    clock.Load({ totalGameTime: time, timeSpeed: 1 });
    clock.EnableTick = true;
    clock.auto_off("advanced");
    tasks.reset();
    driver.resetRemainder();
    return { clock, driver, tasks };
}

function taskAt(id: string, at: number, extra: Partial<TaskRecord> = {}): TaskRecord {
    return {
        id,
        type: "task",
        startTime: at,
        nextSettleAt: at,
        dueAt: at,
        settleLevel: TaskSettleLevel.Minute,
        sequenceType: TaskSequenceType.Other,
        priority: 0,
        sequence: 0,
        executionMode: TaskExecutionMode.Sync,
        timePolicy: TaskTimePolicy.ContinueWorld,
        causalityPolicy: TaskCausalityPolicy.Independent,
        resourceClaims: [],
        dependsOn: [],
        startLatePolicy: TaskLatePolicy.Skip,
        commitLatePolicy: TaskLatePolicy.Skip,
        partialSettlementPolicy: TaskPartialSettlementPolicy.Drop,
        overlapPolicy: TaskOverlapPolicy.Skip,
        asyncRecoveryPolicy: TaskAsyncRecoveryPolicy.Cancel,
        payload: undefined,
        lifecycleState: TaskLifecycleState.Scheduled,
        revision: 1,
        ...extra,
    };
}

const pendingChecks: Promise<void>[] = [];

function check(name: string, run: () => void | Promise<void>): void {
    try {
        const result = run();
        if (result instanceof Promise) {
            pendingChecks.push(
                result.then(
                    () => {
                        console.log(`通过 ${name}`);
                    },
                    (error: unknown) => {
                        const message = error instanceof Error ? error.message : String(error);
                        console.error(`失败 ${name}: ${message}`);
                        throw error;
                    }
                )
            );
            return;
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`失败 ${name}: ${message}`);
        throw error;
    }
    console.log(`通过 ${name}`);
}

function visitsOf(clock: WorldClock): number[] {
    const visits: number[] = [];
    clock.auto_on("advanced", (_fromTime: number, toTime: number) => {
        visits.push(toTime);
    });
    return visits;
}

check("稀疏跳转只落在任务和目标时间", () => {
    const { clock, driver, tasks } = boot(10 * MINUTE);
    const calls: number[] = [];
    const visits = visitsOf(clock);
    tasks.addRecord(taskAt("twelve", 12 * MINUTE), (_task, now) => {
        calls.push(now);
    });
    tasks.addRecord(taskAt("fifteen", 15 * MINUTE), (_task, now) => {
        calls.push(now);
    });
    const result = driver.advanceSlice(16 * MINUTE, BUDGET);
    assert(result.status === "completed", `状态 ${result.status}`);
    assert(clock.TotalGameTime === 16 * MINUTE, `停在 ${clock.TotalGameTime}`);
    assert(calls.join(",") === `${12 * MINUTE},${15 * MINUTE}`, `执行点 ${calls.join(",")}`);
    assert(visits.join(",") === `${12 * MINUTE},${15 * MINUTE},${16 * MINUTE}`, `经过 ${visits.join(",")}`);
});

check("暂停世界停在当前任务，不先写到目标时间", () => {
    const { clock, driver, tasks } = boot(10 * MINUTE);
    const calls: string[] = [];
    const visits = visitsOf(clock);
    tasks.addRecord(
        taskAt("pause", 12 * MINUTE, { timePolicy: TaskTimePolicy.PauseWorld }),
        () => {
            calls.push("pause");
        }
    );
    tasks.addRecord(taskAt("later", 15 * MINUTE), () => {
        calls.push("later");
    });
    const result = driver.advanceSlice(16 * MINUTE, BUDGET);
    assert(result.status === "paused", `状态 ${result.status}`);
    assert(result.pendingDecisionId === "pause", `未决任务 ${result.pendingDecisionId}`);
    assert(clock.TotalGameTime === 12 * MINUTE, `停在 ${clock.TotalGameTime}`);
    assert(calls.join(",") === "pause", `执行了 ${calls.join(",")}`);
    assert(visits.join(",") === `${12 * MINUTE}`, `经过 ${visits.join(",")}`);
});

check("资源被占用时后面的无冲突任务仍能启动", () => {
    const at = 12 * MINUTE;
    const { driver, tasks } = boot(0);
    const calls: string[] = [];
    tasks.Pipeline.resources.tryAcquire(
        {
            executionId: "external",
            taskId: "external",
            taskRevision: 1,
            triggerAt: at,
            settleIntervalFrom: at,
            settleIntervalTo: at,
            status: TaskExecutionStatus.Running,
            priority: 0,
            sequence: 0,
            attempt: 1,
            acquiredResources: [],
            readSet: {},
            recoveryPolicy: TaskAsyncRecoveryPolicy.Cancel,
            idempotencyKey: "external",
        },
        [{ resourceKey: "story:main", access: TaskResourceAccess.Exclusive }]
    );
    const story = (id: string, priority: number, dependsOn: string[] = []) =>
        taskAt(id, at, {
            priority,
            dependsOn,
            resourceClaims: [{ resourceKey: "story:main", access: TaskResourceAccess.Exclusive }],
        });
    tasks.addRecord(story("A", 0), () => {
        calls.push("A");
    });
    tasks.addRecord(
        taskAt("B", at, {
            priority: 1,
            resourceClaims: [{ resourceKey: "settlement:clock", access: TaskResourceAccess.Read }],
        }),
        () => {
            calls.push("B");
        }
    );
    tasks.addRecord(story("C", 2, [makeExecutionId("A", at, 1)]), () => {
        calls.push("C");
    });
    tasks.addRecord(story("D", 3, [makeExecutionId("A", at, 1)]), () => {
        calls.push("D");
    });
    const result = driver.advanceSlice(at, BUDGET);
    assert(result.status === "completed", `状态 ${result.status}`);
    assert(calls.join(",") === "B", `执行了 ${calls.join(",")}`);
    assert(tasks.record("A")?.lifecycleState !== TaskLifecycleState.Completed, "A 不应完成");
    assert(tasks.record("C")?.lifecycleState !== TaskLifecycleState.Completed, "C 不应完成");
});

check("依赖完成后同刻后续任务才启动，且不挡住无关任务", () => {
    const at = 12 * MINUTE;
    const { driver, tasks } = boot(0);
    const calls: string[] = [];
    const remember = (id: string) => () => {
        calls.push(id);
    };
    tasks.addRecord(
        taskAt("A", at, {
            priority: 0,
            resourceClaims: [{ resourceKey: "story:main", access: TaskResourceAccess.Exclusive }],
        }),
        remember("A")
    );
    tasks.addRecord(
        taskAt("B", at, {
            priority: 1,
            resourceClaims: [{ resourceKey: "settlement:clock", access: TaskResourceAccess.Read }],
        }),
        remember("B")
    );
    tasks.addRecord(
        taskAt("C", at, {
            priority: 2,
            dependsOn: [makeExecutionId("A", at, 1)],
            resourceClaims: [{ resourceKey: "story:main", access: TaskResourceAccess.Exclusive }],
        }),
        remember("C")
    );
    tasks.addRecord(
        taskAt("D", at, {
            priority: 3,
            dependsOn: [makeExecutionId("A", at, 1)],
            resourceClaims: [{ resourceKey: "story:main", access: TaskResourceAccess.Exclusive }],
        }),
        remember("D")
    );
    const result = driver.advanceSlice(at, BUDGET);
    assert(result.status === "completed", `状态 ${result.status}`);
    assert(calls.join(",") === "A,B,C,D", `顺序 ${calls.join(",")}`);
});

check("同一时刻按优先级和序号执行", () => {
    const { driver, tasks } = boot(0);
    const calls: string[] = [];
    const remember = (id: string) => () => {
        calls.push(id);
    };
    tasks.addRecord(taskAt("late-priority", 50, { priority: 1, sequence: 5 }), remember("late-priority"));
    tasks.addRecord(taskAt("early-priority", 50, { priority: 0, sequence: 9 }), remember("early-priority"));
    tasks.addRecord(taskAt("earlier-sequence", 50, { priority: 1, sequence: 1 }), remember("earlier-sequence"));
    driver.advanceSlice(50, BUDGET);
    assert(calls.join(",") === "early-priority,earlier-sequence,late-priority", `顺序 ${calls.join(",")}`);
});

check("日切会晋升下一天的任务，空分钟不会逐个停下", () => {
    const { clock, driver, tasks } = boot(0);
    const calls: number[] = [];
    const visits = visitsOf(clock);
    tasks.addRecord(taskAt("evening", 23 * HOUR + 59 * MINUTE), (_task, now) => {
        calls.push(now);
    });
    tasks.addRecord(taskAt("next-morning", DAY + MINUTE), (_task, now) => {
        calls.push(now);
    });
    const result = driver.advanceSlice(DAY + MINUTE, BUDGET);
    assert(result.status === "completed", `状态 ${result.status}`);
    assert(calls.join(",") === `${23 * HOUR + 59 * MINUTE},${DAY + MINUTE}`, `执行点 ${calls.join(",")}`);
    assert(visits.join(",") === `${23 * HOUR + 59 * MINUTE},${DAY},${DAY + MINUTE}`, `经过 ${visits.join(",")}`);
});

check("只处理当前边界，更晚的任务留在索引里", () => {
    const { clock, driver, tasks } = boot(0);
    const calls: string[] = [];
    tasks.addRecord(taskAt("ten", 10 * HOUR), () => {
        calls.push("ten");
    });
    tasks.addRecord(taskAt("eleven", 11 * HOUR), () => {
        calls.push("eleven");
    });
    driver.advanceSlice(10 * HOUR, BUDGET);
    assert(clock.TotalGameTime === 10 * HOUR, `停在 ${clock.TotalGameTime}`);
    assert(calls.join(",") === "ten", `第一次 ${calls.join(",")}`);
    driver.advanceSlice(11 * HOUR, BUDGET);
    assert(calls.join(",") === "ten,eleven", `第二次 ${calls.join(",")}`);
});

check("边界预算用完就让出，不把后面的边界跑完", () => {
    const { clock, driver, tasks } = boot(0);
    const calls: string[] = [];
    tasks.addRecord(taskAt("first", 12 * MINUTE), () => {
        calls.push("first");
    });
    tasks.addRecord(taskAt("second", 15 * MINUTE), () => {
        calls.push("second");
    });
    const result = driver.advanceSlice(16 * MINUTE, { ...BUDGET, maxBoundariesPerSlice: 1 });
    assert(result.status === "yielded", `状态 ${result.status}`);
    assert(clock.TotalGameTime === 12 * MINUTE, `停在 ${clock.TotalGameTime}`);
    assert(calls.join(",") === "first", `执行了 ${calls.join(",")}`);
});

check("同刻任务不断生成时到达上限并停住", () => {
    const { clock, driver, tasks } = boot(0);
    const calls: string[] = [];
    tasks.addRecord(taskAt("root", 100), () => {
        calls.push("root");
        tasks.addRecord(taskAt("child", 100), () => {
            calls.push("child");
        });
    });
    const result = driver.advanceSlice(100, { ...BUDGET, maxSameTimeRounds: 1 });
    assert(result.status === "faulted", `状态 ${result.status}`);
    assert(clock.TotalGameTime === 100, `停在 ${clock.TotalGameTime}`);
    assert(calls.join(",") === "root", `执行了 ${calls.join(",")}`);
    assert((result.faultReason ?? "").includes("root"), `原因 ${result.faultReason}`);
});

check("同刻新任务会在离开这个时间前执行", () => {
    const { driver, tasks } = boot(0);
    const calls: string[] = [];
    tasks.addRecord(taskAt("root", 100), () => {
        calls.push("root");
        tasks.addRecord(taskAt("child", 100), () => {
            calls.push("child");
        });
    });
    const result = driver.advanceSlice(100, BUDGET);
    assert(result.status === "completed", `状态 ${result.status}`);
    assert(calls.join(",") === "root,child", `顺序 ${calls.join(",")}`);
});

check("两个旧读集不能先后覆盖同一实体", () => {
    const { driver, tasks } = boot(0);
    const calls: string[] = [];
    const writeStock = (id: string, value: number, priority: number) => {
        tasks.addRecord(taskAt(id, 40, { priority }), () => {
            calls.push(id);
            return {
                executionId: "",
                readSet: { stock: 0 },
                commands: [{ entityKey: "stock", value }],
                idempotencyKey: "",
            };
        });
    };
    writeStock("first", 3, 0);
    writeStock("second", 9, 1);
    driver.advanceSlice(40, BUDGET);
    assert(calls.join(",") === "first,second,second", `都准备了变更 ${calls.join(",")}`);
    assert(tasks.Pipeline.entities.value("stock") === 3, `库存 ${tasks.Pipeline.entities.value("stock")}`);
    assert(tasks.Pipeline.entities.version("stock") === 1, `版本 ${tasks.Pipeline.entities.version("stock")}`);
    const second = tasks.Pipeline.executions.list().find((execution) => execution.taskId === "second");
    assert(second?.status === TaskExecutionStatus.Failed, `第二次状态 ${second?.status}`);
});

check("同一幂等键不会再次提交", () => {
    const { tasks } = boot(0);
    const change = {
        executionId: "e1",
        readSet: { stock: 0 },
        commands: [{ entityKey: "stock", value: 5 }],
        idempotencyKey: "stock-once",
    };
    tasks.Pipeline.commits.apply(change);
    const gate = tasks.Pipeline.commitGate.check(
        taskAt("once", 0),
        {
            executionId: "e1",
            taskId: "once",
            taskRevision: 1,
            triggerAt: 0,
            settleIntervalFrom: 0,
            settleIntervalTo: 0,
            status: TaskExecutionStatus.Running,
            priority: 0,
            sequence: 0,
            attempt: 1,
            acquiredResources: [],
            readSet: {},
            recoveryPolicy: TaskAsyncRecoveryPolicy.Cancel,
            idempotencyKey: "stock-once",
        },
        change,
        0
    );
    assert(gate.reason === "幂等命中", `门禁 ${gate.reason}`);
    assert(tasks.Pipeline.entities.version("stock") === 1, `版本 ${tasks.Pipeline.entities.version("stock")}`);
});

check("暂停后同一时刻还没跑的任务会在恢复后继续", () => {
    const { clock, driver, tasks } = boot(0);
    const calls: string[] = [];
    tasks.addRecord(
        taskAt("pause", 12 * MINUTE, { timePolicy: TaskTimePolicy.PauseWorld, priority: 0 }),
        () => {
            calls.push("pause");
        }
    );
    tasks.addRecord(taskAt("after", 12 * MINUTE, { priority: 1 }), () => {
        calls.push("after");
    });
    const paused = driver.advanceSlice(20 * MINUTE, BUDGET);
    assert(paused.status === "paused", `状态 ${paused.status}`);
    assert(clock.TotalGameTime === 12 * MINUTE, `停在 ${clock.TotalGameTime}`);
    assert(calls.join(",") === "pause", `暂停前 ${calls.join(",")}`);
    const still = driver.advanceSlice(20 * MINUTE, BUDGET);
    assert(still.status === "paused", `未恢复时 ${still.status}`);
    assert(clock.TotalGameTime === 12 * MINUTE, `未恢复停在 ${clock.TotalGameTime}`);
    assert(calls.join(",") === "pause", "没有玩家决定不能继续");
    driver.resumeAfterDecision();
    const resumed = driver.advanceSlice(20 * MINUTE, BUDGET);
    assert(resumed.status === "completed", `恢复状态 ${resumed.status}`);
    assert(calls.join(",") === "pause,after", `恢复后 ${calls.join(",")}`);
    assert(clock.TotalGameTime === 20 * MINUTE, `恢复后停在 ${clock.TotalGameTime}`);
});

check("读可以并存，写会挡住读", () => {
    const { driver, tasks } = boot(0);
    const arbiter = tasks.Pipeline.resources;
    const execution = (executionId: string) => ({
        executionId,
        taskId: executionId,
        taskRevision: 1,
        triggerAt: 0,
        settleIntervalFrom: 0,
        settleIntervalTo: 0,
        status: TaskExecutionStatus.Running,
        priority: 0,
        sequence: 0,
        attempt: 1,
        acquiredResources: [],
        readSet: {},
        recoveryPolicy: TaskAsyncRecoveryPolicy.Cancel,
        idempotencyKey: executionId,
    });
    const reading = [{ resourceKey: "map", access: TaskResourceAccess.Read }];
    const writing = [{ resourceKey: "map", access: TaskResourceAccess.Write }];
    assert(arbiter.tryAcquire(execution("left-hold"), reading), "第一个读应成功");
    assert(arbiter.tryAcquire(execution("right-hold"), reading), "第二个读应成功");
    assert(!arbiter.canAcquire(writing), "有读锁时不能写");
    arbiter.release("left-hold");
    arbiter.release("right-hold");
    const calls: string[] = [];
    const reader = (id: string) =>
        taskAt(id, 70, {
            resourceClaims: [{ resourceKey: "map", access: TaskResourceAccess.Read }],
        });
    tasks.addRecord(reader("left"), () => {
        calls.push("left");
    });
    tasks.addRecord(reader("right"), () => {
        calls.push("right");
    });
    driver.advanceSlice(70, BUDGET);
    assert(calls.length === 2, `执行了 ${calls.join(",")}`);
});

check("取消和错过开始时间的任务不执行", () => {
    const { clock, driver, tasks } = boot(0);
    const calls: string[] = [];
    tasks.addRecord(taskAt("canceled", 100, { lifecycleState: TaskLifecycleState.Canceled }), () => {
        calls.push("canceled");
    });
    tasks.addRecord(taskAt("on-time", 100, { startBefore: 100 }), () => {
        calls.push("on-time");
    });
    tasks.addRecord(taskAt("too-late", 200, { startBefore: 150 }), () => {
        calls.push("too-late");
    });
    driver.advanceSlice(200, BUDGET);
    assert(clock.TotalGameTime === 200, `停在 ${clock.TotalGameTime}`);
    assert(calls.join(",") === "on-time", `执行了 ${calls.join(",")}`);
    assert(tasks.record("too-late")?.lifecycleState === TaskLifecycleState.Expired, "迟到任务应过期");
});

check("没走完的切片会在下一次真实秒里补上", () => {
    const { clock, driver, tasks } = boot(0);
    const calls: number[] = [];
    tasks.addRecord(taskAt("middle", 50), (_task, now) => {
        calls.push(now);
    });
    tasks.addRecord(taskAt("later", 150), (_task, now) => {
        calls.push(now);
    });
    const yielded = driver.advanceByRealSeconds(1, { ...BUDGET, maxBoundariesPerSlice: 1 });
    assert(yielded.status === "yielded", `状态 ${yielded.status}`);
    assert(clock.TotalGameTime === 50, `停在 ${clock.TotalGameTime}`);
    const continued = driver.advanceByRealSeconds(1, BUDGET);
    assert(continued.status === "completed", `续跑状态 ${continued.status}`);
    assert(clock.TotalGameTime === 200, `最终 ${clock.TotalGameTime}`);
    assert(calls.join(",") === "50,150", `执行点 ${calls.join(",")}`);
});

check("分段真实时间折算后落到同一游戏时间", () => {
    const run = (steps: number[]) => {
        const { clock, driver } = boot(0);
        for (const step of steps) {
            driver.advanceByRealSeconds(step, BUDGET);
        }
        return clock.TotalGameTime;
    };
    assert(run([1, 1, 1]) === run([3]), "整数秒分段不一致");
    assert(run([0.5, 0.5]) === run([1]), "余数分段不一致");
});

check("监听器抛错不会把时钟留在中间", () => {
    const { clock } = boot(0);
    clock.auto_on("advanced", () => {
        throw new Error("监听失败");
    });
    clock.moveTo(40);
    assert(clock.TotalGameTime === 40, `停在 ${clock.TotalGameTime}`);
});

check("旧任务的阻塞标记会暂停世界", () => {
    const { clock, driver, tasks } = boot(0);
    const calls: string[] = [];
    const task = new Task({
        startTime: 80,
        endTime: 0,
        repeatType: TaskRepeatType.Once,
        repeatCount: 0,
        sequenceType: TaskSequenceType.Other,
        blockType: TaskBlockType.Block,
        priority: 0,
        callback: () => {
            calls.push("block");
        },
    });
    tasks.addTask(task);
    const result = driver.advanceSlice(200, BUDGET);
    assert(result.status === "paused", `状态 ${result.status}`);
    assert(clock.TotalGameTime === 80, `停在 ${clock.TotalGameTime}`);
    assert(calls.join(",") === "block", `执行了 ${calls.join(",")}`);
});

check("窗口外的任务到日切后仍会执行", () => {
    const at = FUTURE_DAY_WINDOW * DAY + 2 * MINUTE;
    const { clock, driver, tasks } = boot(0);
    const calls: number[] = [];
    tasks.addRecord(taskAt("far", at), (_task, now) => {
        calls.push(now);
    });
    const result = driver.advanceSlice(at, BUDGET);
    assert(result.status === "completed", `状态 ${result.status} ${result.faultReason ?? ""}`);
    assert(clock.TotalGameTime === at, `停在 ${clock.TotalGameTime}`);
    assert(calls.join(",") === `${at}`, `执行点 ${calls.join(",")}`);
});

function stockResult(executionId: string, taskId: string, value: number, revision = 1) {
    return {
        executionId,
        taskId,
        taskRevision: revision,
        success: true,
        payload: {
            executionId,
            readSet: { stock: 0 },
            commands: [{ entityKey: "stock", value }],
            idempotencyKey: executionId,
        },
    };
}

check("异步结果在边界结束后才提交，世界可以继续", () => {
    const { clock, driver, tasks } = boot(0);
    const calls: string[] = [];
    let stockDuringStart: number | undefined;
    tasks.addRecord(
        taskAt("A", 12, {
            executionMode: TaskExecutionMode.Async,
            causalityPolicy: TaskCausalityPolicy.Independent,
            resourceClaims: [{ resourceKey: "story:main", access: TaskResourceAccess.Exclusive }],
        }),
        () => {
            calls.push("A");
            stockDuringStart = tasks.Pipeline.entities.value("stock");
            const executionId = makeExecutionId("A", 12, 1);
            tasks.Pipeline.acceptExternalResult(stockResult(executionId, "A", 7));
        }
    );
    tasks.addRecord(
        taskAt("B", 13, {
            resourceClaims: [{ resourceKey: "settlement:clock", access: TaskResourceAccess.Read }],
        }),
        () => {
            calls.push("B");
        }
    );
    const result = driver.advanceSlice(14, BUDGET);
    assert(result.status === "completed", `状态 ${result.status}`);
    assert(stockDuringStart === undefined, "发起外部工作时不能写世界");
    assert(calls.join(",") === "A,B", `执行 ${calls.join(",")}`);
    assert(tasks.Pipeline.entities.value("stock") === 7, `库存 ${tasks.Pipeline.entities.value("stock")}`);
    assert(clock.TotalGameTime === 14, `停在 ${clock.TotalGameTime}`);
});

check("依赖的异步结果迟到后不能把时钟倒回去", () => {
    const { clock, driver, tasks } = boot(0);
    const calls: string[] = [];
    tasks.addRecord(
        taskAt("A", 12, {
            executionMode: TaskExecutionMode.Async,
            causalityPolicy: TaskCausalityPolicy.AllowLateResult,
            resourceClaims: [{ resourceKey: "story:main", access: TaskResourceAccess.Exclusive }],
        }),
        () => {
            calls.push("A");
        }
    );
    tasks.addRecord(
        taskAt("E", 15, {
            startBefore: 15,
            dependsOn: [makeExecutionId("A", 12, 1)],
            resourceClaims: [{ resourceKey: "story:main", access: TaskResourceAccess.Exclusive }],
        }),
        () => {
            calls.push("E");
        }
    );
    const missed = driver.advanceSlice(16, BUDGET);
    assert(missed.status === "completed", `状态 ${missed.status}`);
    assert(clock.TotalGameTime === 16, `停在 ${clock.TotalGameTime}`);
    assert(calls.join(",") === "A", `迟到前 ${calls.join(",")}`);
    assert(tasks.record("E")?.lifecycleState === TaskLifecycleState.Expired, "E 应过期");
    tasks.Pipeline.acceptExternalResult(stockResult(makeExecutionId("A", 12, 1), "A", 2));
    driver.advanceSlice(16, BUDGET);
    assert(clock.TotalGameTime === 16, `回流后停在 ${clock.TotalGameTime}`);
    assert(calls.join(",") === "A", "过期任务不能补跑");
    assert(tasks.Pipeline.entities.value("stock") === 2, "迟到结果仍可提交");
});

check("停等外部结果时，后续任务会在结果提交后准时启动", () => {
    const { clock, driver, tasks } = boot(0);
    const calls: string[] = [];
    tasks.addRecord(
        taskAt("A", 12, {
            executionMode: TaskExecutionMode.Async,
            causalityPolicy: TaskCausalityPolicy.StopWorldUntilResult,
            resourceClaims: [{ resourceKey: "story:main", access: TaskResourceAccess.Exclusive }],
        }),
        () => {
            calls.push("A");
        }
    );
    tasks.addRecord(
        taskAt("E", 15, {
            startBefore: 15,
            dependsOn: [makeExecutionId("A", 12, 1)],
        }),
        () => {
            calls.push("E");
        }
    );
    const waiting = driver.advanceSlice(16, BUDGET);
    assert(waiting.status === "awaitingExternalInput", `状态 ${waiting.status}`);
    assert(clock.TotalGameTime === 12, `停在 ${clock.TotalGameTime}`);
    assert(calls.join(",") === "A", `等待中 ${calls.join(",")}`);
    tasks.Pipeline.acceptExternalResult(stockResult(makeExecutionId("A", 12, 1), "A", 5));
    const resumed = driver.advanceSlice(16, BUDGET);
    assert(resumed.status === "completed", `恢复 ${resumed.status}`);
    assert(calls.join(",") === "A,E", `恢复后 ${calls.join(",")}`);
    assert(clock.TotalGameTime === 16, `最终 ${clock.TotalGameTime}`);
});

check("等待外部结果期间，真实秒不推进游戏时间", () => {
    const { clock, driver, tasks } = boot(0);
    tasks.addRecord(
        taskAt("A", 50, {
            executionMode: TaskExecutionMode.Async,
            causalityPolicy: TaskCausalityPolicy.StopWorldUntilResult,
        }),
        () => undefined
    );
    const waiting = driver.advanceByRealSeconds(1, BUDGET);
    assert(waiting.status === "awaitingExternalInput", `状态 ${waiting.status}`);
    assert(clock.TotalGameTime === 50, `停在 ${clock.TotalGameTime}`);
    driver.advanceByRealSeconds(1, BUDGET);
    assert(clock.TotalGameTime === 50, `等待中又走了 ${clock.TotalGameTime}`);
    tasks.Pipeline.acceptExternalResult(stockResult(makeExecutionId("A", 50, 1), "A", 1));
    const resumed = driver.advanceByRealSeconds(1, BUDGET);
    assert(resumed.status === "completed", `恢复 ${resumed.status}`);
    assert(clock.TotalGameTime === 100, `最终 ${clock.TotalGameTime}`);
});

check("录制结果不调用外部服务", () => {
    const { driver, tasks } = boot(0);
    const executionId = makeExecutionId("recorded", 20, 1);
    tasks.Pipeline.acceptExternalResult(stockResult(executionId, "recorded", 8));
    tasks.addRecord(
        taskAt("recorded", 20, {
            executionMode: TaskExecutionMode.Async,
            causalityPolicy: TaskCausalityPolicy.UseRecordedResult,
        }),
        () => {
            throw new Error("不应访问外部服务");
        }
    );
    const result = driver.advanceSlice(20, BUDGET);
    assert(result.status === "completed", `状态 ${result.status} ${result.faultReason ?? ""}`);
    assert(tasks.Pipeline.entities.value("stock") === 8, `库存 ${tasks.Pipeline.entities.value("stock")}`);
});

check("同一异步任务重叠时按策略合并、跳过或再跑一次", () => {
    const run = (policy: TaskOverlapPolicy) => {
        const { clock, driver, tasks } = boot(0);
        const counter = { starts: 0 };
        const record = taskAt("again", 100, {
            executionMode: TaskExecutionMode.Async,
            overlapPolicy: policy,
            causalityPolicy: TaskCausalityPolicy.Independent,
            resourceClaims: [{ resourceKey: "story:main", access: TaskResourceAccess.Exclusive }],
        });
        tasks.addRecord(record, () => {
            counter.starts += 1;
        });
        driver.advanceSlice(100, BUDGET);
        record.nextSettleAt = 200;
        tasks.Schedule.schedule(record, clock.TotalGameTime);
        driver.advanceSlice(200, BUDGET);
        const open = tasks.Pipeline.executions.list();
        return { counter, count: open.length, end: open[0]?.settleIntervalTo, clock, driver, tasks };
    };
    const coalesced = run(TaskOverlapPolicy.Coalesce);
    assert(coalesced.counter.starts === 1, `合并发起 ${coalesced.counter.starts}`);
    assert(coalesced.count === 1, `合并执行数 ${coalesced.count}`);
    assert(coalesced.end === 200, `合并终点 ${coalesced.end}`);
    const skipped = run(TaskOverlapPolicy.Skip);
    assert(skipped.counter.starts === 1 && skipped.count === 1, "跳过应保持一次执行");
    const queued = run(TaskOverlapPolicy.Queue);
    assert(queued.counter.starts === 1, `排队时第二次还不能发起 ${queued.counter.starts}`);
    queued.tasks.Pipeline.acceptExternalResult(stockResult(makeExecutionId("again", 100, 1), "again", 1));
    queued.driver.advanceSlice(200, BUDGET);
    assert(queued.counter.starts === 2, `结果返回后应再发起 ${queued.counter.starts}`);
});

check("重复回流和 revision 不符都不产生第二次副作用", () => {
    const { driver, tasks } = boot(0);
    tasks.addRecord(
        taskAt("A", 10, {
            executionMode: TaskExecutionMode.Async,
            resourceClaims: [{ resourceKey: "story:main", access: TaskResourceAccess.Exclusive }],
        }),
        () => undefined
    );
    driver.advanceSlice(10, BUDGET);
    const executionId = makeExecutionId("A", 10, 1);
    tasks.Pipeline.acceptExternalResult(stockResult(executionId, "A", 3));
    tasks.Pipeline.acceptExternalResult(stockResult(executionId, "A", 9));
    driver.advanceSlice(10, BUDGET);
    assert(tasks.Pipeline.entities.value("stock") === 3, `库存 ${tasks.Pipeline.entities.value("stock")}`);
    assert(tasks.Pipeline.entities.version("stock") === 1, `版本 ${tasks.Pipeline.entities.version("stock")}`);
    const { tasks: mismatched } = boot(0);
    mismatched.addRecord(
        taskAt("B", 10, {
            executionMode: TaskExecutionMode.Async,
            resourceClaims: [{ resourceKey: "story:main", access: TaskResourceAccess.Exclusive }],
        }),
        () => undefined
    );
    driver.advanceSlice(10, BUDGET);
    mismatched.Pipeline.acceptExternalResult(stockResult(makeExecutionId("B", 10, 1), "B", 6, 2));
    driver.advanceSlice(10, BUDGET);
    assert(mismatched.Pipeline.entities.value("stock") === undefined, "revision 不符不能写库存");
    assert(
        mismatched.Pipeline.resources.canAcquire([{ resourceKey: "story:main", access: TaskResourceAccess.Exclusive }]),
        "拒绝结果后应释放资源"
    );
});

check("存档能恢复等待中的执行、编号和换算余数", () => {
    const played = (restoreMidway: boolean) => {
        const { clock, driver } = boot(0);
        driver.advanceByRealSeconds(0.015, BUDGET);
        if (restoreMidway) {
            const saved = captureGame();
            boot(0);
            restoreGame(saved);
        }
        driver.advanceByRealSeconds(0.015, BUDGET);
        return clock.TotalGameTime;
    };
    assert(played(true) === played(false), "读档后续跑和连续推进不一致");

    const { clock, driver, tasks } = boot(0);
    let starts = 0;
    tasks.addRecord(
        taskAt("remote", 30, {
            executionMode: TaskExecutionMode.Async,
            causalityPolicy: TaskCausalityPolicy.Independent,
            resourceClaims: [{ resourceKey: "story:main", access: TaskResourceAccess.Exclusive }],
        }),
        () => {
            starts += 1;
        }
    );
    driver.advanceSlice(30, BUDGET);
    const saved = captureGame();
    boot(0);
    restoreGame(saved);
    clock.EnableTick = true;
    driver.advanceSlice(40, BUDGET);
    assert(starts === 1, `读档后重新发起了 ${starts}`);
    assert(clock.TotalGameTime === 40, `停在 ${clock.TotalGameTime}`);
    assert(
        !tasks.Pipeline.resources.canAcquire([{ resourceKey: "story:main", access: TaskResourceAccess.Exclusive }]),
        "等待中的资源应该还在"
    );
    const execution = tasks.Pipeline.executions.list()[0];
    tasks.Pipeline.acceptExternalResult(stockResult(execution.executionId, "remote", 4));
    driver.advanceSlice(40, BUDGET);
    assert(tasks.Pipeline.entities.value("stock") === 4, `库存 ${tasks.Pipeline.entities.value("stock")}`);

    const serialBefore = peekNextSerial();
    new Task({
        startTime: 0,
        endTime: 0,
        repeatType: TaskRepeatType.Once,
        repeatCount: 0,
        sequenceType: TaskSequenceType.Other,
        blockType: TaskBlockType.NonBlock,
        priority: 0,
        callback: () => undefined,
    });
    const savedSerial = captureGame();
    restoreNextSerial(1);
    restoreGame(savedSerial);
    assert(peekNextSerial() === serialBefore + 1, `编号 ${peekNextSerial()} 期望 ${serialBefore + 1}`);
});

check("版本冲突会重算一次", () => {
    const { driver, tasks } = boot(0);
    let reads = 0;
    tasks.addRecord(taskAt("first", 40, { priority: 0 }), () => ({
        executionId: "",
        readSet: { stock: 0 },
        commands: [{ entityKey: "stock", value: 3 }],
        idempotencyKey: "",
    }));
    tasks.addRecord(taskAt("second", 40, { priority: 1 }), () => {
        reads += 1;
        const version = reads === 1 ? 0 : tasks.Pipeline.entities.version("stock");
        return {
            executionId: "",
            readSet: { stock: version },
            commands: [{ entityKey: "stock", value: 4 }],
            idempotencyKey: "",
        };
    });
    driver.advanceSlice(40, BUDGET);
    assert(reads === 2, `重算次数 ${reads}`);
    assert(tasks.Pipeline.entities.value("stock") === 4, `库存 ${tasks.Pipeline.entities.value("stock")}`);
    assert(tasks.record("second")?.lifecycleState === TaskLifecycleState.Completed, "重算成功应完成");
});

check("末段不足周期时按策略丢弃、按比例或改到结束点", () => {
    const hourEnd = 3600;
    const midway = 1800;
    const drop = boot(0);
    drop.tasks.addRecord(
        taskAt("drop", hourEnd, {
            settleLevel: TaskSettleLevel.Hour,
            activeUntil: midway,
            partialSettlementPolicy: TaskPartialSettlementPolicy.Drop,
        }),
        () => {
            throw new Error("丢弃的末段不应执行");
        }
    );
    drop.driver.advanceSlice(hourEnd, BUDGET);
    assert(drop.tasks.record("drop")?.lifecycleState === TaskLifecycleState.Expired, "应丢弃");

    const ratio = boot(0);
    ratio.tasks.addRecord(
        taskAt("part", hourEnd, {
            settleLevel: TaskSettleLevel.Hour,
            activeUntil: midway,
            partialSettlementPolicy: TaskPartialSettlementPolicy.Proportional,
        }),
        () => ({
            executionId: "",
            readSet: { stock: 0 },
            commands: [{ entityKey: "stock", value: 10 }],
            idempotencyKey: "",
        })
    );
    ratio.driver.advanceSlice(midway, BUDGET);
    const partialExecution = ratio.tasks.Pipeline.executions.list().find((item) => item.taskId === "part");
    assert(partialExecution?.partialRatio === 0.5, `比例 ${partialExecution?.partialRatio}`);
    assert(ratio.tasks.Pipeline.entities.value("stock") === 5, `按比例库存 ${ratio.tasks.Pipeline.entities.value("stock")}`);

    const once = boot(0);
    let ranAt = -1;
    once.tasks.addRecord(
        taskAt("end", hourEnd, {
            settleLevel: TaskSettleLevel.Hour,
            activeUntil: midway,
            partialSettlementPolicy: TaskPartialSettlementPolicy.SettleOnceAtEnd,
        }),
        (_task, now) => {
            ranAt = now;
        }
    );
    once.driver.advanceSlice(hourEnd, BUDGET);
    assert(ranAt === midway, `结束点 ${ranAt}`);
    assert(once.clock.TotalGameTime === hourEnd, `停在 ${once.clock.TotalGameTime}`);
});

check("超时、取消和外部句柄都会释放资源", () => {
    const timed = boot(0);
    timed.tasks.addRecord(
        taskAt("slow", 10, {
            executionMode: TaskExecutionMode.Async,
            timeoutGameSeconds: 5,
            asyncRecoveryPolicy: TaskAsyncRecoveryPolicy.Cancel,
            resourceClaims: [{ resourceKey: "story:main", access: TaskResourceAccess.Exclusive }],
        }),
        () => undefined
    );
    timed.driver.advanceSlice(20, BUDGET);
    assert(timed.tasks.record("slow")?.lifecycleState === TaskLifecycleState.Canceled, "超时应取消");
    assert(
        timed.tasks.Pipeline.resources.canAcquire([{ resourceKey: "story:main", access: TaskResourceAccess.Exclusive }]),
        "超时后应释放资源"
    );

    const live = boot(0);
    let correlation = "";
    live.tasks.addRecord(
        taskAt("http", 10, {
            executionMode: TaskExecutionMode.Async,
            resourceClaims: [{ resourceKey: "story:main", access: TaskResourceAccess.Exclusive }],
        }),
        (task) => {
            const execution = live.tasks.Pipeline.executions.list().find((item) => item.taskId === task.id);
            if (execution) {
                correlation = live.tasks.Pipeline.external.issue(task, execution);
            }
        }
    );
    live.driver.advanceSlice(10, BUDGET);
    assert(live.tasks.Pipeline.external.pendingIds().length === 1, "外部请求应挂起");
    assert(live.tasks.Pipeline.entities.value("stock") === undefined, "完成前不能写世界");
    live.tasks.Pipeline.external.complete(correlation, {
        executionId: "",
        readSet: { stock: 0 },
        commands: [{ entityKey: "stock", value: 6 }],
        idempotencyKey: "",
    });
    live.driver.advanceSlice(10, BUDGET);
    assert(live.tasks.Pipeline.entities.value("stock") === 6, `库存 ${live.tasks.Pipeline.entities.value("stock")}`);

    const aborted = boot(0);
    let abortId = "";
    aborted.tasks.addRecord(
        taskAt("stop", 10, {
            executionMode: TaskExecutionMode.Async,
            resourceClaims: [{ resourceKey: "story:main", access: TaskResourceAccess.Exclusive }],
        }),
        (task) => {
            const execution = aborted.tasks.Pipeline.executions.list().find((item) => item.taskId === task.id);
            if (execution) {
                abortId = aborted.tasks.Pipeline.external.issue(task, execution);
            }
        }
    );
    aborted.driver.advanceSlice(10, BUDGET);
    aborted.tasks.Pipeline.external.abort(abortId);
    aborted.tasks.Pipeline.external.complete(abortId, {
        executionId: "",
        readSet: { stock: 0 },
        commands: [{ entityKey: "stock", value: 1 }],
        idempotencyKey: "",
    });
    aborted.driver.advanceSlice(10, BUDGET);
    assert(aborted.tasks.Pipeline.entities.value("stock") === undefined, "中止后的结果不能提交");
    assert(aborted.tasks.record("stop")?.lifecycleState === TaskLifecycleState.Canceled, "中止应取消任务");
});

check("读档后按类型重新绑定，并按恢复策略再发一次", () => {
    const started = boot(0);
    let first = 0;
    started.tasks.registerType("remote-retry", () => {
        first += 1;
    });
    started.tasks.addRecord(
        taskAt("remote", 30, {
            type: "remote-retry",
            executionMode: TaskExecutionMode.Async,
            asyncRecoveryPolicy: TaskAsyncRecoveryPolicy.Retry,
            maxAttempts: 3,
        })
    );
    started.driver.advanceSlice(30, BUDGET);
    assert(first === 1, `首次发起 ${first}`);
    const saved = captureGame();
    boot(0);
    let second = 0;
    started.tasks.registerType("remote-retry", () => {
        second += 1;
    });
    restoreGame(saved);
    assert(second === 1, `读档重发 ${second}`);
    assert(started.tasks.Pipeline.executions.list()[0]?.attempt === 2, "重发应增加尝试次数");
});

check("活动 revision 变化后旧边界不再执行", () => {
    const { driver, tasks } = boot(0);
    const activities = Instance(ActivityManager) as ActivityManager;
    activities.create({ id: "march", type: "march", revision: 1, startedAt: 0, state: "active" });
    let calls = 0;
    tasks.addRecord(taskAt("arrive", 50, { activityId: "march", activityRevision: 1 }), () => {
        calls += 1;
    });
    activities.bumpRevision("march", 0);
    driver.advanceSlice(50, BUDGET);
    assert(calls === 0, `执行了 ${calls}`);
    assert(tasks.record("arrive")?.lifecycleState === TaskLifecycleState.Expired, "失效边界应结束");
});

check("长周期任务只保留下一次边界，短窗口任务仍会结算", () => {
    const day = 86400;
    const { driver, tasks } = boot(0);
    const calls: string[] = [];
    tasks.addRecord(taskAt("long", 0), (task, now) => {
        calls.push("long");
        task.nextSettleAt = now + 20 * day;
    });
    tasks.addRecord(taskAt("short", 2 * day, { startBefore: 4 * day }), () => {
        calls.push("short");
    });
    driver.advanceSlice(5 * day, BUDGET);
    assert(calls.join(",") === "long,short", `执行 ${calls.join(",")}`);
    assert(tasks.record("long")?.lifecycleState === TaskLifecycleState.Active, "长任务应保持活动");
    assert(tasks.record("long")?.nextSettleAt === 20 * day, "只安排下一次边界");
});

check("滚动窗口会把溢出任务迁回，并接住新的远期任务", () => {
    const day = 86400;
    const { clock, driver, tasks } = boot(0);
    const calls: string[] = [];
    tasks.addRecord(taskAt("far", (FUTURE_DAY_WINDOW + 10) * day), () => {
        calls.push("far");
    });
    assert(tasks.Schedule.locate(tasks.record("far")!) === "overflow", "窗口外应进 overflow");
    driver.advanceSlice(FUTURE_DAY_WINDOW * day, BUDGET);
    assert(tasks.Schedule.locate(tasks.record("far")!) === "future", "滚到窗口内应迁回");
    tasks.addRecord(taskAt("later", (FUTURE_DAY_WINDOW + 20) * day), () => {
        calls.push("later");
    });
    assert(tasks.Schedule.locate(tasks.record("later")!) === "future", "新的远期任务应进未来表");
    driver.advanceSlice((FUTURE_DAY_WINDOW + 20) * day, BUDGET);
    assert(calls.join(",") === "far,later", `执行 ${calls.join(",")}`);
    assert(clock.TotalGameTime === (FUTURE_DAY_WINDOW + 20) * day, `停在 ${clock.TotalGameTime}`);
});

check("非法时间不会进索引，同刻迟到任务仍按策略处理", () => {
    const { driver, tasks } = boot(0);
    tasks.addRecord(taskAt("bad", -1), () => {
        throw new Error("非法时间不应执行");
    });
    assert(tasks.record("bad")?.lifecycleState === TaskLifecycleState.Expired, "非法时间应过期");
    assert(tasks.Schedule.locate(tasks.record("bad")!) === "missing", "非法时间不应占槽");
    let calls = 0;
    tasks.addRecord(taskAt("late", 0, { startLatePolicy: TaskLatePolicy.RunLate }), () => {
        calls += 1;
    });
    driver.advanceSlice(5, BUDGET);
    assert(calls === 1, `补跑 ${calls}`);
});

check("一次推进和分段推进的状态摘要一致", () => {
    const day = 86400;
    const play = (slices: number[]) => {
        const { driver, tasks } = boot(0);
        tasks.addRecord(taskAt("mark", 3 * day), () => ({
            executionId: "",
            readSet: { stock: 0 },
            commands: [{ entityKey: "stock", value: 11 }],
            idempotencyKey: "",
        }));
        let cursor = 0;
        for (const target of slices) {
            cursor = target;
            driver.advanceSlice(cursor, BUDGET);
        }
        return hashGameState();
    };
    const once = play([20 * day]);
    const split = play([5 * day, 12 * day, 20 * day]);
    assert(once === split, `${once} 与 ${split}`);
});

check("365 个游戏日可以推进完且重复运行摘要相同", () => {
    const day = 86400;
    const play = () => {
        const { driver, tasks } = boot(0);
        tasks.addRecord(taskAt("daily", 0, { settleLevel: TaskSettleLevel.Day }), (task, now) => {
            const value = (tasks.Pipeline.entities.value("days") ?? 0) + 1;
            task.nextSettleAt = now + day;
            return {
                executionId: "",
                readSet: { days: tasks.Pipeline.entities.version("days") },
                commands: [{ entityKey: "days", value }],
                idempotencyKey: "",
            };
        });
        const result = driver.advanceSlice(365 * day, BUDGET);
        assert(result.status === "completed", `状态 ${result.status} ${result.faultReason ?? ""}`);
        // 第 0 日和第 365 日都是结算边界，所以经过 365 个游戏日后会结算 366 次。
        assert(tasks.Pipeline.entities.value("days") === 366, `天数 ${tasks.Pipeline.entities.value("days")}`);
        assert(
            tasks.Pipeline.resources.canAcquire([{ resourceKey: "story:main", access: TaskResourceAccess.Exclusive }]),
            "长跑后不应留下资源占用"
        );
        return hashGameState();
    };
    assert(play() === play(), "两次长跑摘要不一致");
});

check("查询恢复超时后释放资源，迟到结果仍可提交", () => {
    const { driver, tasks } = boot(0);
    tasks.addRecord(
        taskAt("query", 10, {
            executionMode: TaskExecutionMode.Async,
            timeoutGameSeconds: 5,
            asyncRecoveryPolicy: TaskAsyncRecoveryPolicy.QueryRemote,
            resourceClaims: [{ resourceKey: "story:main", access: TaskResourceAccess.Exclusive }],
        }),
        () => undefined
    );
    driver.advanceSlice(20, BUDGET);
    const execution = tasks.Pipeline.executions.list()[0];
    assert(execution?.status === TaskExecutionStatus.Waiting, `状态 ${execution?.status}`);
    assert(
        tasks.Pipeline.resources.canAcquire([{ resourceKey: "story:main", access: TaskResourceAccess.Exclusive }]),
        "超时后不应继续占资源"
    );
    tasks.Pipeline.acceptExternalResult(stockResult(execution.executionId, "query", 8));
    driver.advanceSlice(20, BUDGET);
    assert(tasks.Pipeline.entities.value("stock") === 8, `库存 ${tasks.Pipeline.entities.value("stock")}`);
});

check("对不上的外部结果不会留在收件箱", () => {
    const { driver, tasks } = boot(0);
    tasks.Pipeline.acceptExternalResult({
        executionId: "missing:1:1",
        taskId: "missing",
        taskRevision: 1,
        success: true,
    });
    driver.advanceSlice(5, BUDGET);
    assert(tasks.Pipeline.resultInbox.list().length === 0, "无法匹配的结果应丢弃");
});

check("同一时刻的第二次执行使用新的编号", () => {
    const { clock, driver, tasks } = boot(0);
    const record = taskAt("again", 10, {
        executionMode: TaskExecutionMode.Async,
        overlapPolicy: TaskOverlapPolicy.Parallel,
        resourceClaims: [{ resourceKey: "map", access: TaskResourceAccess.Read }],
    });
    tasks.addRecord(record, () => undefined);
    driver.advanceSlice(10, BUDGET);
    record.nextSettleAt = 10;
    tasks.Schedule.schedule(record, clock.TotalGameTime);
    driver.advanceSlice(10, BUDGET);
    const ids = tasks.Pipeline.executions.list().map((item) => item.executionId).sort();
    assert(ids.length === 2, `执行数 ${ids.length}`);
    assert(ids[1] !== ids[0], "两次执行编号不能相同");
});

check("处理函数抛错后任务结束，并且不能在推进中再次推进", () => {
    const { clock, driver, tasks } = boot(0);
    tasks.addRecord(taskAt("boom", 10), () => {
        driver.advanceSlice(30, BUDGET);
    });
    const result = driver.advanceSlice(30, BUDGET);
    assert(result.status === "faulted", `状态 ${result.status}`);
    assert((result.faultReason ?? "").includes("不能在任务推进过程中再次推进"), result.faultReason ?? "");
    assert(clock.TotalGameTime === 10, `停在 ${clock.TotalGameTime}`);
    assert(tasks.record("boom")?.lifecycleState === TaskLifecycleState.Expired, "抛错的任务应结束");
});

check("没有读集的写入会被拒绝", () => {
    const { driver, tasks } = boot(0);
    tasks.addRecord(taskAt("bare", 10), () => ({
        executionId: "",
        readSet: {},
        commands: [{ entityKey: "stock", value: 9 }],
        idempotencyKey: "",
    }));
    driver.advanceSlice(10, BUDGET);
    assert(tasks.Pipeline.entities.value("stock") === undefined, "缺少读集不能写库存");
    assert(tasks.record("bare")?.lifecycleState !== TaskLifecycleState.Completed, "缺少读集不应完成");
});

check("分帧推进只在让出时等待下一帧", async () => {
    const { driver, tasks } = boot(0);
    const calls: number[] = [];
    tasks.addRecord(taskAt("a", 10), (_task, now) => {
        calls.push(now);
    });
    tasks.addRecord(taskAt("b", 20), (_task, now) => {
        calls.push(now);
    });
    tasks.addRecord(taskAt("c", 30), (_task, now) => {
        calls.push(now);
    });
    let frames = 0;
    const result = await driver.advanceFully(30, { ...BUDGET, maxBoundariesPerSlice: 1 }, async () => {
        frames += 1;
    });
    assert(result.status === "completed", `状态 ${result.status}`);
    assert(calls.join(",") === "10,20,30", `执行 ${calls.join(",")}`);
    assert(frames === 2, `帧数 ${frames}`);
});

void Promise.all(pendingChecks).then(
    () => {
        console.log("任务引擎检查通过");
    },
    (error: unknown) => {
        // 失败原因已在各条检查里打印。继续抛出，让本次脚本以失败结束。
        throw error;
    }
);

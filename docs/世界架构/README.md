# 世界架构

文字沙盒的世界模拟内核，以及内核外面的播放器。实现时以 `开发与验收.md` 为准。

## 目录

| 文件 | 内容 |
| --- | --- |
| `开发与验收.md` | 时钟推进、区间结算、活动、里程碑和验收。口径冲突时以这份为准。 |
| `世界驱动架构.md` | 播放器与内核的职责、命令如何进入世界、NPC 只提意图。 |
| `数据结构.md` | 权威状态、Task/事件边界、活动和存档 DTO。 |

任务系统的结算级别、Waiting 与时停拆分、串行提交等细节见 `docs/评审文档/任务系统/游戏任务系统最终方案.md`。

全游戏的技术规划在 `docs/text_sandbox_war_game_technical_plan.md`。世界运行的细节以本目录为准。

## 读的顺序

1. 本文件的已定口径。
2. `开发与验收.md` 的推进循环和验收。
3. `世界驱动架构.md` 的模块边界。
4. `数据结构.md` 的类型和不变量。

## 已定口径

世界分两层：**真实时间**与**游戏世界时间**。游戏时间由时钟持续推进，任务系统对每段 `(from, to]` 结算。

- **播放器**在内核之外。在线 Tick 和离线补时都把目标交给 `WorldDriver`；默认 1 真实秒 = 100 游戏秒。速率不写入权威世界状态。
- **世界时钟**只保存整数累计游戏时间，并由 WorldDriver 原子推进。业务代码、Task 和监听器都不能私自拨动。
- **任务结算**按绝对 `nextSettleAt` 统一排序；`listen_min/hour/day/month/year` 只保留派生通知，不参与权威调度。
- **advance** 不是日常唯一推进入口；它是挂机补算、离线追赶、测试快进的入口。遇到显式 **`TimePolicy = PauseWorld`** 的任务边界时，advance 停在当时并返回。
- **任务等待**不等于世界时停。Async 让出调度器；显式资源/依赖只阻塞冲突 Task；只有 PauseWorld 才暂停游戏时间。
- **异步结果**只能通过持久化 ResultCommand 在内核安全点回流。若后续世界依赖结果，使用 StopWorldUntilResult；ContinueWorld 下迟到依赖按 LatePolicy 处理，不能回到过去。
- **推进预算**：核心 advanceSlice 同步并可返回 Yielded；异步 advanceFully 只负责跨帧续跑，不等待业务 Promise。同刻循环超限返回 Faulted。
- **日检测**是 cadence=Day 的普通 Task，由 nextSettleAt 调度，不是时钟监听器。
- **精确时刻**（抵达、离开、断粮、战斗阶段等）可建模为单次或分钟级 Task，在所属区间内按确定性顺序结算。
- **任务调度**采用未来日表 + 今日分钟表 + overflow 的可重建 ScheduleIndex；权威数据在 TaskRepository。
- **任务有效性**不属于索引。TriggerGate、StartGate、CommitGate 分别复验 deadline、依赖、资源、revision、readSet/entityVersion 和幂等键。
- **活动**是持续过程的权威生命周期。取消和改计划时递增版本号，结算时 revision 不符则跳过。
- 粮食、行军等连续量用锚点和整数余数推导；日结算不再扣同一份粮。
- 处理器只提交变更集，不能反向拨动时钟，不能在结算回调里嵌套 advance。
- 权威状态**串行提交**；异步等待可并行，回写必须排队。
- 存档用版本化 DTO。随机数、实体序号、Task/事件序号和待恢复 execution 都要保存；不存 Promise 与运行时堆。

## 一天（业务节奏，非时间引擎硬边界）

| 种类 | 何时结算 | 优先级 | 负责的事 |
| --- | --- | --- | --- |
| 精确时刻 Task | 到期落在当前 `(from, to]` 内 | 100–140 | 断粮、需 PauseWorld 的决定、抵达、离开、战斗阶段、紧急评估 |
| 日检测 Task | 相对 Start 或配置的游戏日边界 | 200 | 生产、税收、军饷、英雄是否刷新、无法预测的相遇、常规战略评估 |

间隔短于日检测的停留，要等下一次检测才看得见。需要更密，就把日 cadence 或检测间隔调短。

## 实现顺序

基础修复与整数时间 → TaskRepository / ExecutionRecord → 两级 ScheduleIndex 与 scanCursor → WorldDriver 同步切片/推进预算 → ReadyScheduler / ResourceArbiter / DependencyGraph → DurableResultInbox / 三段 Gate / Finalizer → 版本化全局提交 → 原子存档与回放。

`assets/src/framwork/data_structures/direct-address-table.ts` 是当前 Task 调度的核心基础设施。未来 Task 按日、今日 Task 按分钟定位；槽内再按时间、序列类型、优先级和稳定序号排序。

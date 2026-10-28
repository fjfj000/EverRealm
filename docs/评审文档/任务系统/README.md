# 任务系统评审

本目录保存受控时间边界推进、两级调度索引、资源/依赖仲裁、异步执行、版本化提交与存档恢复的评审记录。任务引擎已实现，检查脚本是 `scripts/check-task-engine.ts`。

## 阅读顺序

1. [游戏任务系统最终方案](游戏任务系统最终方案.md)：修订设计基线，重点是统一绝对时间边界与安全 TaskPipeline。
2. [任务队列数据结构评审](任务队列数据结构评审.md)：两级索引复杂度、ReadyScheduler、ResourceArbiter、ExecutionRecord 和 ResultInbox。
3. [候选方案：按日分桶与全局跳表](候选方案-按日分桶与全局跳表.md)：历史选型；按日分桶方向已演进为两级直址表。

与世界架构的关系：在线 Tick、`advance`、PauseWorld 与存档以 `docs/世界架构/开发与验收.md` 为准；本目录定义 WorldDriver 如何按 `nextSettleAt` 推进，以及 TaskSequenceType、资源互斥和业务依赖的职责边界。

## 验收场景索引

完整表格见最终方案 **§13**。世界架构 **§12 验收清单**与之对齐，重点包括：

| 主题 | 编号 / 项 |
| --- | --- |
| 在线 Tick vs 分段 advance 等价 | T02、确定性 A/B/C |
| 长周期 Active + 短窗口 Task | T03、长/短 Task 共存 |
| A 异步 Waiting 时 B 仍按时启动 | T04、防吞噬例子 |
| PauseWorld 与 advance 截断 | T05、PauseWorld |
| ChangeSet 版本冲突 | T06 |
| OverlapPolicy 重入 | T07 |
| 末段不足周期 | T08 |
| 原子读档恢复 ExecutionRecord | T09、存档 |
| 365 日长跑 | T10、长跑 |
| 跨日、同刻循环、资源队头阻塞 | T11～T15 |
| Async 恢复与死锁防护 | T16～T17 |
| 时钟原子性、资源冲突、滚动窗口、整数时间 | T18～T22 |
| 因果异步、ResultCommand、推进预算、位图摊还扫描 | T23～T27 |

挂机与离线：播放器用 `advance` 追赶，在线 Tick 与 advance 共用 WorldDriver 的绝对边界循环；遇 PauseWorld 或具有因果影响的未决外部输入时停止。

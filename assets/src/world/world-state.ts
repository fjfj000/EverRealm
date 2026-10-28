import { setInstance } from "../framwork/utils/instance";
import { GameTime } from "../task/task-contract";

/** 世界主状态占位。实体、随机流和序号后续放在这里，不放任务索引。 */
@setInstance
export class WorldState {
    public readonly now: GameTime = 0;

    public save(): unknown {
        return {};
    }

    public load(_dto: unknown): void {}
}

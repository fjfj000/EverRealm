import { GameTime } from "../task/task-contract";

/**
 * 在两个绝对边界之间结算粮食、行军等连续量。
 * 用锚点和整数余数一次算到边界，不按分钟扫描全世界。
 */
export class ContinuousUpdater {
    public settle(fromTime: GameTime, toTime: GameTime): void {
        void fromTime;
        void toTime;
    }
}

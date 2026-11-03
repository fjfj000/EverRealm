import { GameTimeUnit, gameTimeRemainder } from "../../framwork/utils/date-utils";
import { GameTime } from "../task-contract";

/** 未来日表覆盖的游戏日数量：从今天起的五年。再往后进入 overflow。 */
export const FUTURE_DAY_WINDOW = 360 * 5;

export function absoluteGameDay(gameTime: GameTime): number {
    return Math.floor(gameTime / GameTimeUnit.day);
}

export function minuteOfDay(gameTime: GameTime): number {
    return Math.floor(gameTimeRemainder(gameTime, "day") / GameTimeUnit.minute);
}

/** 下一次日切。当前正好在 0 点时，下一次是明天 0 点。 */
export function nextDayBoundary(gameTime: GameTime): GameTime {
    const dayStart = Math.floor(gameTime / GameTimeUnit.day) * GameTimeUnit.day;
    return dayStart + GameTimeUnit.day;
}

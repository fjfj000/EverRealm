import { GameTime } from "../task/task-contract";
import { AdvanceResult } from "./world-driver";

/**
 * 内核外面的播放器。
 * 只提交真实时间增量或离线目标，不直接改 WorldClock，也不执行任务。
 */
export class SessionPlayer {
    public setRate(gameSecondsPerRealSecond: number): void {
        void gameSecondsPerRealSecond;
    }

    public onRealTimeElapsed(realSeconds: number): AdvanceResult | null {
        void realSeconds;
        return null;
    }

    public onResume(elapsedRealSeconds: number): AdvanceResult {
        void elapsedRealSeconds;
        return {
            status: "completed",
            fromTime: 0,
            toTime: 0,
            targetTime: 0,
            processedBoundaries: 0,
            processedExecutions: 0,
            sameTimeRounds: 0,
        };
    }

    public continueAfterDecision(targetTime: GameTime): AdvanceResult {
        void targetTime;
        return this.onResume(0);
    }
}

export const WorldConfig = {
    /**
     * 当前用户倍速，只影响之后的游戏时间。
     * 运行中改 WorldClock.TimeSpeed。不能用它把累计真实时间乘回去得到累计游戏时间。
     */
    TimeSpeed: 1,
    /** 固定倍率。1 真实秒在 1 倍速下推进多少游戏秒。用户不改这个值。 */
    TickRate: 100,
    /** 世界最小时间步长，单位秒。 */
    Step: 60,
};

export type TWorldConfig = typeof WorldConfig;
